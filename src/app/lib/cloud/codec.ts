const TAG = "__payroll_cloud_binary_v1";
async function pack(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return {
      [TAG]: true,
      data: btoa(binary),
      mime: value.type,
      name:
        typeof File !== "undefined" && value instanceof File
          ? value.name
          : null,
      modified:
        typeof File !== "undefined" && value instanceof File
          ? value.lastModified
          : null,
    };
  }
  if (value instanceof Date)
    return { __payroll_cloud_date_v1: value.toISOString() };
  if (Array.isArray(value)) return Promise.all(value.map(pack));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = await pack(entry);
    }
    return result;
  }
  return value;
}
export async function encode(value: unknown): Promise<Blob> {
  const text = JSON.stringify({ value: await pack(value) });
  return new Response(
    new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
  ).blob();
}
export async function decode(blob: Blob): Promise<unknown> {
  const text = await new Response(
    blob.stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();
  return JSON.parse(text, (_key, value) => {
    if (value?.[TAG] === true) {
      const bytes = Uint8Array.from(atob(value.data), (char) =>
        char.charCodeAt(0),
      );
      return value.name !== null
        ? new File([bytes], value.name, {
            type: value.mime,
            lastModified: value.modified,
          })
        : new Blob([bytes], { type: value.mime });
    }
    if (typeof value?.__payroll_cloud_date_v1 === "string")
      return new Date(value.__payroll_cloud_date_v1);
    return value;
  }).value;
}
export async function digest(blob: Blob): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
