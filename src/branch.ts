import { readFileSync } from 'fs';
import { join } from 'path';
import { TOTAL_INSTANCES } from './constant';

export const allBranchs = JSON.parse(
  readFileSync(join(process.cwd(), 'secret', 'branch.json'), 'utf-8'),
);

export function getInsBranchs(branchCode: string): number {
  let hash = 0;
  for (let i = 0; i < branchCode.length; i++) {
    hash += branchCode.charCodeAt(i);
  }
  return hash % TOTAL_INSTANCES;
}
