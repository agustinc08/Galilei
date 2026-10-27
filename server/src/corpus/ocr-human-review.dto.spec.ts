import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';
import {
  OCR_REVIEW_PAGE_TEXT_LIMIT,
  SaveOcrReviewPageDto,
} from './ocr-human-review.dto';

describe('OCR human review request validation', () => {
  it('rejects oversized corrected page text', async () => {
    const input = plainToInstance(SaveOcrReviewPageDto, {
      expectedVersion: 1,
      correctedText: 'x'.repeat(OCR_REVIEW_PAGE_TEXT_LIMIT + 1),
    });

    const errors = await validate(input);

    expect(errors.map(({ property }) => property)).toContain('correctedText');
  });

  it('rejects mass-assigned approval fields through the configured validation contract', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });

    await expect(
      pipe.transform(
        { expectedVersion: 1, correctedText: 'texto', approved: true },
        { type: 'body', metatype: SaveOcrReviewPageDto },
      ),
    ).rejects.toThrow();
  });
});
