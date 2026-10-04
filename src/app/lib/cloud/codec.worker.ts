import { encode, decode, digest } from "./codec";
self.onmessage = async ({ data }) => {
  try {
    const result =
      data.operation === "encode"
        ? await encode(data.value)
        : await decode(data.value);
    self.postMessage({
      id: data.id,
      result,
      hash: result instanceof Blob ? await digest(result) : undefined,
    });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : "Không thể đọc dữ liệu",
    });
  }
};
