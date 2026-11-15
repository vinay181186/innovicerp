// ADR-289 — body of POST /drawing-files/print. Local to the route: the web
// helper (apps/web/src/lib/drawing-url.ts logDrawingPrint) sends exactly
// { itemRevisionId?, path? }; one of the two names the drawing.
import { z } from 'zod';

export const drawingPrintBodySchema = z
  .object({
    itemRevisionId: z.string().uuid().optional(),
    path: z.string().trim().min(1).max(1024).optional(),
  })
  .refine((b) => Boolean(b.itemRevisionId) || Boolean(b.path), {
    message: 'Name the drawing to print (Drawing Rev or file).',
  });

export type DrawingPrintBody = z.infer<typeof drawingPrintBodySchema>;
