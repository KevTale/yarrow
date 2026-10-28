import { ImagePlus, X } from "lucide-react";
import { useId, useState } from "react";
import { Logo } from "./boards";

/** Logos are stored at this size: enough for a 40 px tile on a 3x screen. */
const SIZE = 128;

/**
 * Draws an image (a URL the page may read, a data URL) into a square,
 * transparent where it does not fill.
 */
export async function drawLogo(source: string): Promise<string> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const width = image.naturalWidth || SIZE;
  const height = image.naturalHeight || SIZE;
  const scale = Math.min(SIZE / width, SIZE / height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  // A 16 px favicon blown up stays crisp rather than blurred.
  context.imageSmoothingEnabled = scale < 3;
  const w = width * scale;
  const h = height * scale;
  context.drawImage(image, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  // Browsers that cannot encode WebP fall back to PNG.
  return canvas.toDataURL("image/webp", 0.9);
}

/** The chosen file, drawn as a logo. */
async function drawFile(file: File): Promise<string> {
  const source = URL.createObjectURL(file);
  try {
    return await drawLogo(source);
  } finally {
    URL.revokeObjectURL(source);
  }
}

/**
 * The logo tile itself is the upload button. `value` is the stored URL, or
 * a data URL until the form is saved; null shows the initial.
 */
export function LogoPicker({
  name,
  value,
  onChange,
  size = "large",
  removable = value !== null,
}: {
  name: string;
  value: string | null;
  onChange: (next: string | null) => void;
  size?: "large" | "small";
  /** False when the tile shows a fallback (a GitHub avatar), not an upload. */
  removable?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState(false);
  return (
    <span className={`logo-picker ${size}`}>
      <label htmlFor={id} title={value ? "Change the logo" : "Add a logo"}>
        <Logo name={name || "?"} url={value} size={size} />
        <span className="logo-picker-hint" aria-hidden="true">
          <ImagePlus size={size === "large" ? 16 : 13} />
        </span>
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
          aria-label={value ? "Change the logo" : "Add a logo"}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setError(false);
            try {
              onChange(await drawFile(file));
            } catch {
              setError(true);
            }
          }}
        />
      </label>
      {removable && (
        <button
          type="button"
          className="logo-picker-remove"
          aria-label="Remove the logo"
          onClick={() => onChange(null)}
        >
          <X size={10} strokeWidth={2.6} />
        </button>
      )}
      {error && (
        <span className="logo-picker-error" role="alert">
          That image could not be read
        </span>
      )}
    </span>
  );
}
