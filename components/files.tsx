"use client";
import { useState } from "react";
import { Upload, Camera } from "lucide-react";
export function FileDropzone({
  label,
  accept,
  hint,
  onFile,
}: {
  label: string;
  accept: string;
  hint: string;
  onFile: (f: File) => void;
}) {
  return (
    <div
      className="drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <Upload size={23} />
      <strong>{label}</strong>
      <span className="hint">{hint}</span>
      <input
        type="file"
        aria-label={label}
        accept={accept}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
export function PhotoUploader({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [error, setError] = useState("");
  function choose(f: File) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
      f.size > 10 * 1024 * 1024
    ) {
      setError("Choose a JPG, PNG, or WebP under 10 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError("");
      onChange(String(reader.result));
    };
    reader.onerror = () =>
      setError("This photo could not be read. Try another file.");
    reader.readAsDataURL(f);
  }
  return (
    <div className="stack">
      <span className="label">Your {name}</span>
      <FileDropzone
        label={value ? "Replace photo" : "Choose a photo or drop it here"}
        hint="JPG, PNG or WebP · Up to 10 MB"
        accept="image/jpeg,image/png,image/webp"
        onFile={choose}
      />
      <div className="row">
        <label className="filepick btn secondary">
          <Camera size={15} /> Use camera
          <input
            type="file"
            aria-label="Take a photo"
            accept="image/*"
            capture="user"
            onChange={(e) => {
              if (e.target.files?.[0]) choose(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </label>
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setError("");
            }}
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="danger">
          {error}
        </p>
      )}
    </div>
  );
}
