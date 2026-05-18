import fs from "fs";
import { PDFParse } from "pdf-parse"; 

async function parsePDF(pdfPath) {

  const dataBuffer = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: dataBuffer });
  const textResult = await parser.getText();
  
  let rawText = textResult.text;

  const cleanedText = rawText.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "");

  return cleanedText; 
}

parsePDF("./movie.pdf")

export { parsePDF };