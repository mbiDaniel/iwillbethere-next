export type PlaceholderType = "text" | "image";
export interface PlaceholderOptions {
  maxLines?: number;
  maxLength?: number;
  align?: "left" | "center" | "right";
  minFontSize?: number;
  maxFontSize?: number;
  fallbackFont?: string;
  fit?: "cover" | "contain";
  useShapeAsMask?: boolean;
}
export interface Placeholder {
  id: string;
  layerName: string;
  key: string;
  type: PlaceholderType;
  sampleValue?: string;
  box: { x: number; y: number; w: number; h: number };
  options: PlaceholderOptions;
}
export interface Event {
  id: string;
  slug: string;
  title: string;
  date: string;
  description: string;
  artwork: string;
  status: "Published" | "Draft";
  count: number;
  placeholders: Placeholder[];
  fonts: { name: string; status: string }[];
  manifestUrl?: string | null;
  manifestKey?: string | null;
}
