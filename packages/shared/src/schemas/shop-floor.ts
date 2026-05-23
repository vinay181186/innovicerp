// Shop Floor shared schemas (Production slice E).
//
// Live running ops grouped by machine. Mirrors legacy renderShopFloor
// (HTML L10286).

import { z } from 'zod';

export const shopFloorRunningRowSchema = z.object({
  runningOpId: z.string().uuid(),
  jcOpId: z.string().uuid(),
  jcId: z.string().uuid().nullable(),
  jcCode: z.string(),
  opSeq: z.number().int().positive(),
  operation: z.string(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  soCode: z.string().nullable(),
  orderQty: z.number().int().nonnegative(),
  doneQty: z.number().int().nonnegative(),
  pendingQty: z.number().int().nonnegative(),
  priority: z.string(),
  dueDate: z.string().nullable(),
  operatorName: z.string().nullable(),
  startDate: z.string(),
  startTime: z.string(),
});
export type ShopFloorRunningRow = z.infer<typeof shopFloorRunningRowSchema>;

export const shopFloorMachineSchema = z.object({
  machineId: z.string().uuid(),
  machineCode: z.string(),
  machineName: z.string().nullable(),
  machineType: z.string().nullable(),
  runningCount: z.number().int().nonnegative(),
  rows: z.array(shopFloorRunningRowSchema),
});
export type ShopFloorMachine = z.infer<typeof shopFloorMachineSchema>;

export interface ShopFloorResponse {
  total: number;
  machines: ShopFloorMachine[];
}
