export const XML_MAX_BYTES = 5 * 1024 * 1024;

export function transferProgress(
  loaded: number,
  total: number,
  lengthComputable: boolean,
) {
  const measurableTotal = lengthComputable && total > 0 ? total : 0;
  return {
    loaded,
    total: measurableTotal,
    percent:
      measurableTotal > 0
        ? Math.min(100, Math.round((loaded / measurableTotal) * 100))
        : 0,
  };
}

export type XmlFileRejection = "missing" | "multiple" | "extension" | "size";

export interface UploadFileLike {
  name: string;
  size: number;
}

export function validateXmlSelection(files: readonly UploadFileLike[]) {
  if (files.length === 0) return "missing" satisfies XmlFileRejection;
  if (files.length !== 1) return "multiple" satisfies XmlFileRejection;
  const [file] = files;
  if (!/\.xml$/i.test(file.name)) return "extension" satisfies XmlFileRejection;
  if (file.size > XML_MAX_BYTES) return "size" satisfies XmlFileRejection;
  return null;
}

export const xmlFileRejectionMessage: Record<XmlFileRejection, string> = {
  missing: "Selecciona un archivo XML.",
  multiple: "Sólo puedes cargar un XML por proceso.",
  extension: "El archivo debe tener extensión .xml.",
  size: "El XML no puede superar 5 MiB.",
};
