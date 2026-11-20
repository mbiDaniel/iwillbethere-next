import Link from "next/link";
import { Layers, Type, Image as ImageIcon, Check, X } from "lucide-react";
import { MarketingLayout } from "@/components/shell";
const topics = [
  {
    icon: Layers,
    title: "Name your layers",
    yes: "#PLACEHOLDER_Name",
    no: "Name copy 2",
    body: "Prefix each editable layer with #PLACEHOLDER_ and give it a unique key. Leave fixed artwork unmarked.",
  },
  {
    icon: ImageIcon,
    title: "Frame the photo",
    yes: "#PLACEHOLDER_photo",
    no: "Smart object placeholder",
    body: "Use a solid shape layer for circular photo frames. Set cover or contain in the inspector; guests only choose the image.",
  },
  {
    icon: Type,
    title: "Set the type",
    yes: "Horizontal text layer",
    no: "Rotated or warped text",
    body: "Style the text layer exactly as you want it to appear. Keep it horizontal and avoid smart objects. Guests change the words, not the font, size, color, or position.",
  },
];
export default function Page() {
  return (
    <MarketingLayout>
      <main className="wrap work">
        <span className="kicker">
          <Layers size={14} /> Designer guide
        </span>
        <h1>Set the stage.</h1>
        <p className="lead">
          Three ways to prepare a Photoshop flyer for your guests.
        </p>
        <div className="step-grid guide-grid">
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
        <Link href="/dashboard/events/new" className="btn primary">
          Create an event
        </Link>
      </main>
    </MarketingLayout>
  );
}
