export const INSTANCE_ID = Number(process.env.NODE_APP_INSTANCE || 0);
export const TOTAL_INSTANCES = Number(process.env.NODE_APP_INSTANCES || 1);

if (!Number.isInteger(TOTAL_INSTANCES) || TOTAL_INSTANCES < 1 ||
    !Number.isInteger(INSTANCE_ID) || INSTANCE_ID < 0 || INSTANCE_ID >= TOTAL_INSTANCES) {
  throw new Error('Invalid instance configuration: require 0 <= NODE_APP_INSTANCE < NODE_APP_INSTANCES');
}
