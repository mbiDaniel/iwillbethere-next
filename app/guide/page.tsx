import Link from "next/link";
import { Layers, Type, Image as ImageIcon, Check, X, Scissors, Sparkles, FolderTree, Cpu, Eye } from "lucide-react";
import { MarketingLayout } from "@/components/shell";

const topics = [
  {
    icon: Layers,
    title: "Name your layers",
    yes: "#PLACEHOLDER_name",
    no: "Name copy 2",
    body: "Prefix each editable layer with #PLACEHOLDER_ and give it a unique key. Leave fixed artwork unmarked.",
  },
  {
    icon: ImageIcon,
    title: "Frame the photo",
    yes: "#PLACEHOLDER_photo",
    no: "Smart object placeholder",
    body: "Use a solid shape layer for circular or custom photo frames. Set cover or contain in the inspector; guests only choose the image.",
  },
  {
    icon: Type,
    title: "Set the typography",
    yes: "Horizontal text layer",
    no: "Rotated or warped text",
    body: "Style the text layer exactly as you want it to appear. Keep it horizontal. Guests change the words, not the font, size, color, or position.",
  },
];

const technicalGuides = [
  {
    icon: Scissors,
    title: "How browser-side slicing works",
    body: "When you upload your PSD, your browser parses the file locally in a Web Worker without uploading the heavy PSD to guests. Consecutive artwork layers are merged into compact PNG slices, cutting only where placeholders sit in the stack. Guests download only small slices (~1-2 MB total) instead of a 60+ MB PSD.",
  },
  {
    icon: Sparkles,
    title: "Why rasterize layer effects",
    body: "Photoshop layer effects (Drop Shadow, Outer Glow, Stroke, Bevel & Emboss, Gradient Overlay) cannot always be rendered identically in standard canvas composite pipelines. For pixel-perfect fidelity, right-click the layer in Photoshop and choose 'Rasterize Layer Style' before exporting.",
  },
  {
    icon: FolderTree,
    title: "Placeholders inside groups",
    body: "Placeholders can be organized inside folders. If a group has opacity, the placeholder inherits it automatically. However, avoid putting placeholders inside groups with complex group layer masks or non-normal blend modes, as group clipping across slices cannot be guaranteed.",
  },
  {
    icon: Cpu,
    title: "Keep slice counts low (3 to 6 slices)",
    body: "Each placeholder layer splits the layer stack into an additional slice. Merging decorative background and foreground layers in Photoshop keeps the total slice count between 3 and 6, reducing HTTP requests and giving guests a lightning-fast preview.",
  },
  {
    icon: Eye,
    title: "Reading the fidelity compare view",
    body: "In the designer inspector, the Fidelity card compares your recomposited flyer against Photoshop's embedded composite image. Use the Side-by-Side view to inspect styling or the Difference Overlay (where red pixels flag visual discrepancies). If fidelity is low, you can also enable the Flattened Fallback option.",
  },
];

export default function Page() {
  return (
    <MarketingLayout>
      <main className="wrap work stack" style={{ gap: "32px" }}>
        <div>
          <span className="kicker">
            <Layers size={14} /> Designer guide
          </span>
          <h1>Set the stage.</h1>
          <p className="lead">
            How to prepare Photoshop flyers for client-side composition and browser slicing.
          </p>
        </div>

        <div>
          <h2>Core setup guidelines</h2>
          <div className="step-grid guide-grid" style={{ marginTop: "16px" }}>
            {topics.map(({ icon: Icon, title, yes, no, body }, i) => (
              <article className="panel stack" key={title}>
                <div className={`guide-diagram color${i}`}>
                  <Icon size={30} />
                  <code className="row">
                    <Check size={15} /> {yes}
                  </code>
                  <code className="row">
                    <X size={15} /> {no}
                  </code>
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>

        <div>
          <h2>Artwork slicing & fidelity optimization</h2>
          <div className="stack" style={{ gap: "16px", marginTop: "16px" }}>
            {technicalGuides.map(({ icon: Icon, title, body }) => (
              <article key={title} className="panel row" style={{ gap: "16px", alignItems: "flex-start" }}>
                <div style={{ padding: "10px", background: "var(--muted)", borderRadius: "8px", flexShrink: 0 }}>
                  <Icon size={22} className="text-primary" />
                </div>
                <div className="stack" style={{ gap: "4px" }}>
                  <h3 style={{ margin: 0, fontSize: "1.05rem" }}>{title}</h3>
                  <p style={{ margin: 0, color: "var(--muted-foreground)", fontSize: "0.92rem", lineHeight: 1.5 }}>
                    {body}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div>
          <Link href="/dashboard/events/new" className="btn primary">
            Create an event
          </Link>
        </div>
      </main>
    </MarketingLayout>
  );
}
