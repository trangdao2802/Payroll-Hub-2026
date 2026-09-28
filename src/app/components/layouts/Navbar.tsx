/* eslint-disable @typescript-eslint/no-unused-vars */
import { Link, useLocation } from "react-router";
import { DataChangeHistoryToggle } from "../DataChangeHistoryToggle";
import {
  CircleDollarSign,
  Building2,
  Database,
  ShieldCheck,
  CreditCard,
  Table2,
  Bell,
  User,
  Settings,
  Settings2,
  Trash2,
  Menu,
  ListChecks,
  Users,
  BarChart3,
  Coins,
  Wallet,
  CalendarIcon,
  UploadCloud,
  RefreshCw,
  FileText,
  AlertCircle,
  ChevronDown,
  LayoutDashboard,
  Check,
} from "lucide-react";
import { motion } from "motion/react";
import { useState, useEffect, useRef } from "react";
import { useAppData } from "../../lib/contexts/AppDataContext";
import { TableData } from "../../types";
import { MonthPicker } from "../shared/MonthPicker";
import { toast } from "sonner";
import { syncReportingMonthReconciliation } from "../../lib/utils/reconciliation-sync";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

const navigationItems = [
  { id: "dashboard", label: "dashboard", icon: LayoutDashboard, path: "/" },
  { id: "centers", label: "timesheet", icon: BarChart3, path: "/centers" },
  { id: "audit", label: "audit", icon: ShieldCheck, path: "/audit" },
  { id: "master-ae", label: "master", icon: Database, path: "/master-ae" },
  { id: "hold-dashboard", label: "balance", icon: Wallet, path: "/hold-dashboard" },
];

const pageTabs: Record<string, { id: string; label: string; icon: React.ElementType }[]> = {
  "/centers": [
    { id: "employee", label: "Total Hours", icon: Users },
    { id: "center", label: "Roster Center", icon: Building2 },
    { id: "mkt_local_north", label: "Pivot Timesheet", icon: Table2 },
    { id: "roster_raw", label: "Raw Data", icon: FileText },
    { id: "type_rates", label: "Rate Type", icon: Coins },
    { id: "upload", label: "Setting Timesheet", icon: UploadCloud },
  ],
  "/audit": [
    { id: "main", label: "Audit Overview", icon: ShieldCheck },
    { id: "detail", label: "Audit Details", icon: AlertCircle },
    { id: "rules", label: "Allowed Rules", icon: ListChecks },
  ],
  "/master-ae": [
    { id: "Sheet1_AE", label: "Gross Pay", icon: CircleDollarSign },
    { id: "Hold_AE", label: "Deductions", icon: CreditCard },
    { id: "BulkPayment", label: "Bulk Payment", icon: Wallet },
    { id: "Pivot", label: "Pivot Master", icon: Table2 },
    { id: "upload", label: "Setting Master", icon: UploadCloud },
  ],
};

interface NavbarProps {
  onOpenSettings: () => void;
}

export function Navbar({ onOpenSettings }: NavbarProps) {
  const location = useLocation();
  const { appData, updateAppData } = useAppData();
  const [timesheetActiveTabId, setTimesheetActiveTabId] = useState("employee");
  const [activeTabLabel, setActiveTabLabel] = useState(() => {
    return sessionStorage.getItem("active_timesheet_tab_label") || "Total Paid Hours";
  });

  useEffect(() => {
    const handleTabChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.label) {
        setActiveTabLabel(detail.label);
        sessionStorage.setItem("active_timesheet_tab_label", detail.label);
      }
      if (detail && detail.tab) {
        setTimesheetActiveTabId(detail.tab);
      }
    };
    window.addEventListener("timesheet-tab-changed", handleTabChange);
    return () => {
      window.removeEventListener("timesheet-tab-changed", handleTabChange);
    };
  }, []);

  const isTimesheetPage = location.pathname === "/centers";
  
  const [masterActiveTab, setMasterActiveTab] = useState(() => {
    return (localStorage.getItem("master_ae_active_tab") as string) || "Sheet1_AE";
  });

  const [auditActiveTab, setAuditActiveTab] = useState(() => (
    sessionStorage.getItem("audit_active_tab") || "main"
  ));

  useEffect(() => {
    const handleTabChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tab) {
        setMasterActiveTab(detail.tab);
      }
    };
    window.addEventListener("master-ae-tab-changed", handleTabChange);
    return () => {
      window.removeEventListener("master-ae-tab-changed", handleTabChange);
    };
  }, []);

  useEffect(() => {
    const handleAuditTabChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.tab) {
        setAuditActiveTab(detail.tab);
        sessionStorage.setItem("audit_active_tab", detail.tab);
      }
    };
    window.addEventListener("audit-tab-changed", handleAuditTabChange);
    return () => {
      window.removeEventListener("audit-tab-changed", handleAuditTabChange);
    };
  }, []);

  const lookupPath = location.pathname;
  const currentTabId =
    lookupPath === "/master-ae" ? masterActiveTab :
    lookupPath === "/audit" ? auditActiveTab :
    lookupPath === "/centers" ? timesheetActiveTabId : "";

  const currentTabObj = pageTabs[lookupPath]?.find((t) => t.id === currentTabId);

  const currentPageLabel = (
    location.pathname === "/" ? "Dashboard" :
    location.pathname === "/hold-dashboard" ? "Balance" :
    currentTabObj ? currentTabObj.label :
    (isTimesheetPage ? activeTabLabel : "Select View")
  );

  const showMonthCard = location.pathname === "/master-ae" || location.pathname === "/hold-dashboard" || location.pathname === "/payment" || location.pathname === "/pivot";
  const shouldAutoSyncReconciliation = location.pathname === "/master-ae" || location.pathname === "/payment" || location.pathname === "/pivot";
  const currentMonth = appData.globalMonth || "03.2026";
  const bankSourceRowCount = appData.Bank_North_AE?.data?.length || 0;
  const lastAutoSyncedMonthRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldAutoSyncReconciliation || bankSourceRowCount === 0) {
      lastAutoSyncedMonthRef.current = null;
      return;
    }
    if (lastAutoSyncedMonthRef.current === currentMonth) return;

    lastAutoSyncedMonthRef.current = currentMonth;
    updateAppData((prev) =>
      syncReportingMonthReconciliation(prev, currentMonth),
    );
  }, [bankSourceRowCount, currentMonth, shouldAutoSyncReconciliation, updateAppData]);

  return (
    <header 
      id="app-navbar"
      className={`navbar-header ${showMonthCard ? "navbar-header--with-month" : ""} px-6 flex justify-between items-center relative z-40 shrink-0 w-full max-w-full overflow-visible h-[35.4924px] backdrop-blur-md transition-all duration-300 bg-transparent`}
      style={{
        background: "transparent",
        height: "35.4924px",
      }}
    >
      {/* Oozing loang/bleed transition glow right below the navbar */}
      <div 
        className="absolute bottom-[-32px] left-0 right-0 h-32 pointer-events-none opacity-60 z-[-1]"
        style={{
          background: "transparent",
          filter: "blur(24px)",
        }}
      />
        <div className="navbar-brand-area flex min-w-0 items-center gap-1.5">
          <Link
            to="/"
            className="app-brand-lockup select-none border-0 bg-transparent p-0 shadow-none no-underline outline-none transition-transform active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            title="Dashboard"
            aria-label="Về Dashboard"
            aria-current={location.pathname === "/" ? "page" : undefined}
          >
            <span className="sr-only">Payroll Hub</span>
            <span className="app-brand-wordmark" aria-hidden="true" />
          </Link>
          {location.pathname !== "/" && pageTabs[lookupPath] && (
            <div className="navbar-current-view flex min-w-0 items-center animate-in fade-in slide-in-from-left-4 duration-300">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="navbar-view-trigger flex min-w-0 items-center gap-1.5 h-7 transition-all group font-bold text-xs tracking-tight cursor-pointer active:scale-95 px-1 bg-transparent border-0 shadow-none outline-none focus:outline-none focus-visible:outline-none"
                    aria-label={`Chuyển bảng, hiện tại: ${currentPageLabel}`}
                  >
                    <span 
                      className="navbar-current-label truncate font-bold text-[14px] px-[2px]"
                      style={{ fontWeight: "bold", fontSize: "14px", paddingLeft: "2px", paddingRight: "2px" }}
                    >
                      {currentPageLabel}
                    </span>
                    <ChevronDown className="w-3 h-3 opacity-60 group-hover:opacity-100 transition-opacity" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={8}
                  collisionPadding={8}
                  className="table-switch-menu w-52 p-1.5 bg-card border border-border shadow-xl rounded-xl"
                >
                  {pageTabs[lookupPath].map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      onSelect={() => {
                        if (lookupPath === "/centers") {
                           window.dispatchEvent(new CustomEvent("timesheet-request-tab-change", { detail: { tab: t.id } }));
                        } else if (lookupPath === "/audit") {
                           window.dispatchEvent(new CustomEvent("audit-request-tab-change", { detail: { tab: t.id } }));
                        } else if (lookupPath === "/master-ae") {
                           window.dispatchEvent(new CustomEvent("master-ae-request-tab-change", { detail: { tab: t.id } }));
                        }
                      }}
                      className={`text-xs font-semibold px-3 py-2 rounded-lg cursor-pointer flex items-center gap-2 transition-colors outline-none ${
                        t.id === currentTabId
                          ? lookupPath === "/centers"
                            ? "bg-[#E4ECEF] text-[#1E2C35] font-bold"
                            : lookupPath === "/audit"
                            ? "bg-[#F8EEF1] text-[#2D2126] font-bold"
                            : "bg-[#DFE7DC] text-[#2B362A] font-bold"
                          : "text-foreground hover:bg-muted/70"
                      }`}
                    >
                      <t.icon className="w-3.5 h-3.5 opacity-80" />
                      {t.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        
        <div className="navbar-actions flex shrink-0 items-center gap-6">
          <nav className="hidden md:flex gap-6 items-center">
              {navigationItems.filter((item) => item.id !== "dashboard").map((item) => {
                const isActive = location.pathname === item.path;
                const toneClass =
                  item.id === "centers" || item.id === "timesheet"
                    ? { activeText: "text-[#574116]", line: "bg-[#FBE8B9]", hoverText: "hover:text-[#574116]" }
                    : item.id === "audit"
                    ? { activeText: "text-[#4A2630]", line: "bg-[#F0CCCE]", hoverText: "hover:text-[#4A2630]" }
                    : item.id === "master-ae"
                    ? { activeText: "text-[#59261D]", line: "bg-[#CC7C6B]", hoverText: "hover:text-[#59261D]" }
                    : { activeText: "text-[#1E2C35]", line: "bg-[#C6D6E7]", hoverText: "hover:text-[#1E2C35]" };

                return (
                  <Link
                    key={item.id}
                    to={item.path}
                    className={`font-sans lowercase font-semibold tracking-wider text-xs no-underline relative transition-all outline-none ${
                      isActive
                        ? `${toneClass.activeText} font-bold after:content-[''] after:absolute after:-bottom-[16px] after:left-0 after:w-full after:h-[2px] ${toneClass.line}`
                        : `text-muted-foreground ${toneClass.hoverText}`
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
          </nav>
   
          <div className="text-right text-xs text-foreground flex items-center justify-end gap-2" style={{ fontFamily: "var(--font-main)" }}>
              {showMonthCard && (
                <div className="origin-right">
                  <MonthPicker
                    value={currentMonth}
                    onChange={(newVal) => {
                      if (newVal) {
                        updateAppData((prev) => ({ ...prev, globalMonth: newVal }));
                      }
                    }}
                    align="end"
                  />
                </div>
              )}

              {/* Recent Data Changes History & Integrated Restore Copy Toggle */}
              <DataChangeHistoryToggle />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mobile-navigation-trigger hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-card text-primary shadow-xs transition-colors hover:bg-primary/5 active:scale-[0.98] max-md:flex"
                aria-label="Mở điều hướng chính"
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="mobile-navigation-menu w-56">
              <DropdownMenuLabel className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                Điều hướng
              </DropdownMenuLabel>
              {navigationItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <DropdownMenuItem key={item.id} asChild>
                    <Link
                      to={item.path}
                      className={isActive ? "bg-primary/10 text-primary" : "text-foreground"}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <item.icon className="h-4 w-4" aria-hidden="true" />
                      <span className="capitalize">{item.label}</span>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onOpenSettings}>
                <Settings2 className="h-4 w-4" aria-hidden="true" />
                <span>Cài đặt giao diện</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
    </header>
  );
}
