import { Injectable } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class PdfService {
  async extraerTexto(pdfPath: string): Promise<string> {
    const buffer = await readFile(pdfPath);
    const parser = new PDFParse({ data: buffer });

    try {
      const result = await parser.getText();
      return this.cleanText(result.text);
    } finally {
      await parser.destroy();
    }
  }

  private cleanText(text: string) {
    return text.replace(/\s+/g, ' ').trim();
  }
}
