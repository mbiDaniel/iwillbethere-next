export type PlaceholderType = "text" | "image";

export interface PlaceholderBox {
  x: number;
  y: number;
  w: number;
  h: number;
  xPx?: number;
  yPx?: number;
  wPx?: number;
  hPx?: number;
}

export interface ExtractedTextStyle {
  fontFamily?: string;
  fontStyle?: string;
  fontSize?: number;
  color?: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  tracking?: number;
}

export interface ExtractedPlaceholder {
  id: string;
  layerId: string;
  layerName: string;
  key: string;
  type: PlaceholderType;
  sampleValue?: string;
  box: PlaceholderBox;
  options: {
    maxLines?: number;
    maxLength?: number;
    align?: "left" | "center" | "right";
    minFontSize?: number;
    maxFontSize?: number;
    fallbackFont?: string;
    fit?: "cover" | "contain";
    useShapeAsMask?: boolean;
    framingMode?: "face" | "center" | "custom";
    focalPoint?: { x: number; y: number };
  };
  textStyle?: ExtractedTextStyle;
  maskBuffer?: Buffer;
  maskKey?: string;
  isSmartObject?: boolean;
  isAdjustmentLayer?: boolean;
}

export type ManifestItem =
  | { kind: "slice"; url: string; width: number; height: number }
  | { kind: "placeholder"; placeholderId: string };

export interface ManifestPlaceholder {
  id: string;
  key: string;
  type: PlaceholderType;
  box: PlaceholderBox;
  options: ExtractedPlaceholder["options"];
  textStyle?: ExtractedTextStyle;
  maskUrl?: string;
  sampleValue?: string;
}

export interface ManifestFont {
  family: string;
  weight?: number;
  style?: string;
  url?: string;
  missing: boolean;
}

export interface RenderManifest {
  version: 1;
  width: number;
  height: number;
  items: ManifestItem[];
  placeholders: ManifestPlaceholder[];
  fonts: ManifestFont[];
}

export type ValidationSeverity = "error" | "warning" | "passed";

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  layerName?: string;
  placeholderId?: string;
}
