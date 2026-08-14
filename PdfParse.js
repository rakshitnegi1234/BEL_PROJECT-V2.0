import fs from "fs";
import { PDFParse } from "pdf-parse";

async function parseMoviePdf(pdfPath) {

  const pdfBuffer = fs.readFileSync(pdfPath);

  const pdfParser = new PDFParse({ data: pdfBuffer });

  const parseResult = await pdfParser.getText();

  const pdfText = parseResult.text;


  const cleanedText = pdfText.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "");

  return cleanedText;
}

export { parseMoviePdf };
