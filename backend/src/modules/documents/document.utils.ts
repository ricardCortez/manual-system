import { exec } from "child_process";
import { promisify } from "util";
import pdfParse from "pdf-parse";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

// ──────────────────────────────────────────────────────
// Extracción de texto de distintos formatos
// ──────────────────────────────────────────────────────

export async function extractTextFromFile(
  filePath: string,
  mimeType: string
): Promise<string | null> {
  try {
    if (mimeType === "application/pdf") {
      const buffer = await fs.readFile(filePath);
      const data = await pdfParse(buffer, { max: 0 });
      return data.text?.slice(0, 500_000) || null; // Limitar a 500K chars
    }

    if (mimeType === "text/markdown" || filePath.endsWith(".md")) {
      return await fs.readFile(filePath, "utf-8");
    }

    return null;
  } catch (err) {
    console.error("[extractText] Error:", err);
    return null;
  }
}

// ──────────────────────────────────────────────────────
// Conversión de Office a PDF con LibreOffice headless
// ──────────────────────────────────────────────────────

export async function convertToPdf(inputPath: string, outputDir: string): Promise<string> {
  const libreoffice = process.env.LIBREOFFICE_BIN || "libreoffice";
  const timeout = parseInt(process.env.LIBREOFFICE_TIMEOUT_MS || "60000");

  await execAsync(
    `${libreoffice} --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`,
    { timeout }
  );

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const pdfPath = path.join(outputDir, `${baseName}.pdf`);

  // Verificar que el PDF fue creado
  await fs.access(pdfPath);
  return pdfPath;
}

// ──────────────────────────────────────────────────────
// Generación de thumbnail de la primera página
// ──────────────────────────────────────────────────────

export async function generateThumbnail(
  filePath: string,
  mimeType: string,
  outputDir: string,
  versionLabel: string
): Promise<string | null> {
  try {
    const thumbPath = path.join(outputDir, `thumb_v${versionLabel}.jpg`);

    if (mimeType === "application/pdf") {
      // Usar pdftoppm o ImageMagick
      await execAsync(
        `pdftoppm -jpeg -r 150 -f 1 -l 1 "${filePath}" "${outputDir}/thumb_v${versionLabel}"`,
        { timeout: 30000 }
      );

      // pdftoppm genera thumb_v1.0.0-1.jpg
      const generated = path.join(outputDir, `thumb_v${versionLabel}-1.jpg`);
      try {
        await fs.rename(generated, thumbPath);
      } catch {
        return null;
      }

      return thumbPath;
    }

    if (mimeType.startsWith("image/")) {
      // Para imágenes, crear thumbnail directamente
      const sharp = (await import("sharp")).default;
      await sharp(filePath).resize(400, 566, { fit: "inside" }).toFile(thumbPath);
      return thumbPath;
    }

    return null;
  } catch (err) {
    console.error("[generateThumbnail] Error:", err);
    return null;
  }
}
