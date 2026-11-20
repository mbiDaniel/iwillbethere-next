import type { Event } from "@/lib/types";
import { ImagePlus } from "lucide-react";
export function FlyerPreview({
  event,
  values = {},
  sample = false,
  highlighted,
  onSelect,
  onFocusField,
}: {
  event: Event;
  values?: Record<string, string>;
  sample?: boolean;
  highlighted?: string;
  onSelect?: (id: string) => void;
  onFocusField?: (id: string) => void;
}) {
  return (
    <div className="flyer">
      <img
        className="poster"
        alt={`${event.title} event artwork`}
        src={event.artwork}
      />
      <div className="stub">
        <span>I WILL BE THERE</span>
        <i aria-hidden="true" />
      </div>
      {event.placeholders.map((p, i) => {
        const value = values[p.id] ?? (sample ? p.sampleValue : "");
        const b = p.box;
        return (
          <div
            key={p.id}
            className={`slot ${!value || onSelect ? "outlined" : ""} ${highlighted === p.id ? "highlighted" : ""}`}
            style={{
              left: b.x + "%",
              top: b.y + "%",
              width: b.w + "%",
              height: b.h + "%",
              borderRadius:
                p.type === "image" && p.options.useShapeAsMask ? "50%" : 0,
              textAlign: p.options.align,
              alignContent: "center",
              fontSize: `clamp(${(p.options.minFontSize ?? 9) / 4}cqw,${Math.min((p.options.maxFontSize ?? 28) / 3.4, (95 * (p.options.maxLines ?? 1)) / Math.max(value?.length ?? 1, 1))}cqw,10cqw)`,
              fontFamily: p.options.fallbackFont,
              whiteSpace: (p.options.maxLines ?? 1) > 1 ? "normal" : "nowrap",
            }}
          >
            {p.type === "image" ? (
              value ? (
                <img
                  alt="Guest portrait"
                  src={value}
                  style={{ objectFit: p.options.fit }}
                />
              ) : (
                <ImagePlus size="48%" />
              )
            ) : (
              value || `Your ${p.key.toLowerCase()}`
            )}
            {onFocusField && (
              <button
                type="button"
                className="field-jump"
                aria-label={`Go to ${p.key} field`}
                onClick={() => onFocusField(p.id)}
              />
            )}
            {onSelect && (
              <button
                className="box-select"
                aria-label={`Select ${p.key}`}
                onClick={() => onSelect(p.id)}
              >
                {i + 1}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
