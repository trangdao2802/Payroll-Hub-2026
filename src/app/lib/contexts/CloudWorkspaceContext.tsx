import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Cloud, CloudOff, LoaderCircle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../../lib/supabaseClient";
import { useAppActions, useAppDataOnly } from "./AppDataContext";
import { CloudRepository } from "../cloud/repository";
import { SyncEngine, OWNER_KEY, type SyncState } from "../cloud/engine";
import { saveSnapshot } from "../utils/snapshot-manager";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
interface CloudContextValue {
  open: () => void;
  state: SyncState;
  authenticated: boolean;
}
const Context = createContext<CloudContextValue | null>(null);
// This hook deliberately shares the same context as the provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useCloudWorkspace() {
  return useContext(Context);
}
export function CloudSyncButton() {
  const cloud = useContext(Context);
  if (!cloud) return null;
  const label = !cloud.authenticated
    ? "Đăng nhập để đồng bộ"
    : cloud.state.status === "synced"
      ? "Đồng bộ: Bật"
      : cloud.state.status === "saving"
        ? "Đang đồng bộ"
        : cloud.state.status === "conflict"
          ? "Xung đột dữ liệu"
          : "Kiểm tra đồng bộ";
  return (
    <button
      type="button"
      onClick={cloud.open}
      title={label}
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/20 px-2 py-1 text-[10px] text-primary whitespace-nowrap active:scale-[0.98]"
    >
      {cloud.state.status === "saving" || cloud.state.status === "starting" ? (
        <LoaderCircle className="h-3 w-3 animate-spin" />
      ) : cloud.state.status === "offline" ? (
        <CloudOff className="h-3 w-3" />
      ) : (
        <Cloud className="h-3 w-3" />
      )}
      <span className="max-md:hidden">{label}</span>
    </button>
  );
}
export function CloudWorkspaceProvider({ children }: { children: ReactNode }) {
  const { rawAppData, isStorageHydrating } = useAppDataOnly();
  const { applyCloudData } = useAppActions();
  const dataRef = useRef(rawAppData);
  useLayoutEffect(() => {
    dataRef.current = rawAppData;
  }, [rawAppData]);
  const engine = useRef<SyncEngine | null>(null);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [authReady, setAuthReady] = useState(() => !isSupabaseConfigured());
  const [state, setState] = useState<SyncState>(() =>
    isSupabaseConfigured()
      ? { status: "starting" }
      : { status: "error", message: "Chưa có cấu hình cloud." },
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unlockedOwner, setUnlockedOwner] = useState<string | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let alive = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (alive) {
        setUser(data.session?.user || null);
        setAuthReady(true);
        if (error) setLoginError(error.message);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      // The callback only updates React state; network calls run in the effect below.
      setUser((previous) =>
        previous?.id === session?.user.id ? previous : session?.user || null,
      );
      setAuthReady(true);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!authReady || isStorageHydrating || !user) return;
    let alive = true;
    const instance = new SyncEngine(
      new CloudRepository(user.id),
      () => dataRef.current,
      applyCloudData,
      (next) => {
        if (alive) {
          setState(next);
          if (
            next.status === "synced" ||
            next.status === "saving" ||
            next.status === "conflict" ||
            (next.status === "offline" &&
              localStorage.getItem(OWNER_KEY) === user.id)
          )
            setUnlockedOwner(user.id);
        }
      },
      async () => {
        await saveSnapshot(dataRef.current, {
          title: "Bản máy trước đồng bộ cloud",
          trigger: "restore",
          isPinned: true,
        });
      },
    );
    engine.current = instance;
    void instance.start();
    const retry = () => void instance.retry();
    const interval = setInterval(retry, 30000);
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      alive = false;
      instance.stop();
      engine.current = null;
      clearInterval(interval);
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
  }, [authReady, isStorageHydrating, user, applyCloudData]);
  useEffect(() => {
    engine.current?.changed();
  }, [rawAppData]);
  const owned = localStorage.getItem(OWNER_KEY);
  const gated =
    !authReady || (!!user && unlockedOwner !== user.id) || (!!owned && !user);
  const showDialog = dialogOpen || (authReady && gated);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setLoginError("");
    try {
      const { data: loginData, error } = await supabase.auth.signInWithPassword(
        { email: email.trim(), password },
      );
      if (error) throw error;
      setUser(loginData.user);
      setDialogOpen(false);
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "Không thể đăng nhập",
      );
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  const messages: Record<SyncState["status"], string> = {
    starting: "Đang mở dữ liệu cloud…",
    saving: "Đang lưu thay đổi lên cloud…",
    synced: "Đồng bộ giữa các máy: Bật",
    offline: "Mất kết nối — thay đổi đang được giữ trên máy.",
    conflict: "Cần chọn bản dữ liệu",
    error: "Đồng bộ chưa hoàn tất",
  };
  return (
    <Context.Provider
      value={{ open: () => setDialogOpen(true), state, authenticated: !!user }}
    >
      {gated ? (
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          {!authReady ? "Đang kiểm tra đăng nhập…" : "Mở dữ liệu đồng bộ"}
        </div>
      ) : (
        children
      )}
      <Dialog open={showDialog} onOpenChange={setDialogOpen}>
        <DialogContent
          onKeyDown={(event) => event.stopPropagation()}
          onInteractOutside={(event) => {
            if (gated) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (gated) event.preventDefault();
          }}
          className="max-w-md"
        >
          <DialogTitle>Đồng bộ giữa các máy</DialogTitle>
          <DialogDescription>
            Dùng cùng tài khoản trên các máy để mở dữ liệu lương và các tháng đã
            lưu. Tự đồng bộ sau khi đăng nhập.
          </DialogDescription>
          {!user ? (
            <form onSubmit={login} className="space-y-3">
              <label className="block text-sm">
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 w-full rounded-lg border bg-background p-2"
                />
              </label>
              <label className="block text-sm">
                Mật khẩu
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1 w-full rounded-lg border bg-background p-2"
                />
              </label>
              {loginError && (
                <p role="alert" className="text-sm text-red-700">
                  {loginError}
                </p>
              )}
              <button
                type="submit"
                disabled={busy || !isSupabaseConfigured()}
                className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                {busy ? "Đang đăng nhập…" : "Đăng nhập"}
              </button>
            </form>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="break-all text-muted-foreground">{user.email}</p>
              <p role="status">{messages[state.status]}</p>
              {state.message && (
                <p className="text-muted-foreground">{state.message}</p>
              )}
              {state.updatedAt && (
                <p className="text-xs text-muted-foreground">
                  Lần lưu cloud:{" "}
                  {new Date(state.updatedAt).toLocaleString("vi-VN")}
                </p>
              )}
              {state.status === "conflict" ? (
                <>
                  <p className="break-words text-xs">
                    {state.conflicts?.join(", ")}
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="rounded-full bg-primary px-3 py-2 text-primary-foreground"
                      onClick={() => void engine.current?.resolve(false)}
                    >
                      Dùng bản cloud
                    </button>
                    <button
                      className="rounded-full border px-3 py-2"
                      onClick={() => void engine.current?.resolve(true)}
                    >
                      Giữ bản máy
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Ứng dụng tạo bản sao trên máy trước khi xử lý xung đột.
                  </p>
                </>
              ) : (
                <button
                  className="rounded-full border px-3 py-2"
                  onClick={() => void engine.current?.retry()}
                >
                  Đồng bộ ngay
                </button>
              )}
              <button
                className="block text-xs text-muted-foreground underline"
                onClick={() => void supabase.auth.signOut()}
              >
                Đăng xuất
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Lưu cloud riêng tư trên gói miễn phí, tối đa 200 MB dữ liệu làm việc
            sau nén. Đồng bộ dữ liệu đang dùng và tháng đã lưu; các bản sao lịch
            sử đầy đủ vẫn nằm trên máy.
          </p>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}
