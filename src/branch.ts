import { readFileSync } from 'fs';
import { join } from 'path';
import { INSTANCE_ID, TOTAL_INSTANCES } from './constant';

export const allBranchs = JSON.parse(
  readFileSync(join(process.cwd(), 'secret', 'branch.json'), 'utf-8'),
);

if (!Array.isArray(allBranchs) || allBranchs.some((branch) => typeof branch.code !== 'string' || !branch.code.trim())) {
  throw new Error('secret/branch.json must be an array of branches with nonempty string codes');
}
if (new Set(allBranchs.map((branch) => branch.code)).size !== allBranchs.length) {
  throw new Error('Duplicate branch codes in secret/branch.json');
}

export function getInsBranchs(branchCode: string): number {
  let hash = 0;
  for (let i = 0; i < branchCode.length; i++) {
    hash += branchCode.charCodeAt(i);
  }
  return hash % TOTAL_INSTANCES;
}

export const assignedBranchs = allBranchs.filter((branch) => getInsBranchs(branch.code) === INSTANCE_ID);
