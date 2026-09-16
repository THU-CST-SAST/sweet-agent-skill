import { DeviceStatus } from '../types';

/**
 * Device status helper utilities to support both Loop and AAPS (AndroidAPS/OpenAPS)
 */

export type DeviceType = 'loop' | 'aaps' | 'unknown';

/**
 * Detect the type of closed-loop system based on device status
 */
export const detectDeviceType = (deviceStatus: DeviceStatus | null): DeviceType => {
  if (!deviceStatus) {
    return 'unknown';
  }
  
  // Check for Loop data
  if (deviceStatus.loop) {
    return 'loop';
  }
  
  // Check for AAPS/OpenAPS data
  if (deviceStatus.openaps) {
    return 'aaps';
  }
  
  return 'unknown';
};

/**
 * Get display name for device type
 */
export const getDeviceTypeDisplayName = (deviceType: DeviceType): string => {
  const displayNames: Record<DeviceType, string> = {
    loop: 'Loop',
    aaps: 'AAPS',
    unknown: '--',
  };
  return displayNames[deviceType];
};

/**
 * Get IOB (Insulin on Board) value regardless of device type
 */
export const getIOBValue = (deviceStatus: DeviceStatus | null): number | null => {
  if (!deviceStatus) {
    return null;
  }
  
  // Loop IOB
  if (deviceStatus.loop?.iob?.iob !== undefined) {
    return deviceStatus.loop.iob.iob;
  }
  
  // AAPS IOB
  if (deviceStatus.openaps?.iob?.iob !== undefined) {
    return deviceStatus.openaps.iob.iob;
  }
  
  return null;
};

/**
 * Get COB (Carbs on Board) value regardless of device type
 */
export const getCOBValue = (deviceStatus: DeviceStatus | null): number | null => {
  if (!deviceStatus) {
    return null;
  }
  
  // Loop COB
  if (deviceStatus.loop?.cob?.cob !== undefined) {
    return deviceStatus.loop.cob.cob;
  }
  
  // AAPS COB (from suggested data)
  if (deviceStatus.openaps?.suggested?.COB !== undefined) {
    return deviceStatus.openaps.suggested.COB;
  }
  
  return null;
};

/**
 * Get basal rate regardless of device type
 */
export const getBasalRate = (deviceStatus: DeviceStatus | null): number | null => {
  if (!deviceStatus) {
    return null;
  }
  
  // Loop basal rate
  if (deviceStatus.loop?.enacted?.rate !== undefined) {
    return deviceStatus.loop.enacted.rate;
  }
  
  // AAPS basal rate (from suggested data)
  if (deviceStatus.openaps?.suggested?.rate !== undefined) {
    return deviceStatus.openaps.suggested.rate;
  }
  
  // AAPS temp basal rate from pump extended
  if (deviceStatus.pump?.extended?.TempBasalAbsoluteRate !== undefined) {
    return deviceStatus.pump.extended.TempBasalAbsoluteRate;
  }
  
  return null;
};

/**
 * Get predicted BG values regardless of device type
 */
export const getPredictedBG = (deviceStatus: DeviceStatus | null): number[] => {
  if (!deviceStatus) {
    return [];
  }
  
  // Loop predicted values
  if (deviceStatus.loop?.predicted?.values && Array.isArray(deviceStatus.loop.predicted.values)) {
    return deviceStatus.loop.predicted.values;
  }
  
  // AAPS predicted values (from IOB predictions)
  if (deviceStatus.openaps?.suggested?.predBGs?.IOB && Array.isArray(deviceStatus.openaps.suggested.predBGs.IOB)) {
    return deviceStatus.openaps.suggested.predBGs.IOB;
  }
  
  return [];
};

/**
 * Get loop/AAPS timestamp
 */
export const getLoopTimestamp = (deviceStatus: DeviceStatus | null): string | null => {
  if (!deviceStatus) {
    return null;
  }
  
  // Loop timestamp
  if (deviceStatus.loop?.timestamp) {
    return deviceStatus.loop.timestamp;
  }
  
  // AAPS timestamp (from iob or suggested)
  if (deviceStatus.openaps?.iob?.time) {
    return deviceStatus.openaps.iob.time;
  }
  
  if (deviceStatus.openaps?.suggested?.timestamp) {
    return deviceStatus.openaps.suggested.timestamp;
  }
  
  // Fallback to device created_at
  if (deviceStatus.created_at) {
    return deviceStatus.created_at;
  }
  
  return null;
};

/**
 * Get uploader battery percentage regardless of device type
 */
export const getUploaderBattery = (deviceStatus: DeviceStatus | null): number | null => {
  if (!deviceStatus) {
    return null;
  }
  
  // Standard uploader battery
  if (deviceStatus.uploader?.battery !== undefined) {
    return deviceStatus.uploader.battery;
  }
  
  // AAPS uploaderBattery field
  if (deviceStatus.uploaderBattery !== undefined) {
    return deviceStatus.uploaderBattery;
  }
  
  return null;
};

/**
 * Get pump reservoir amount
 */
export const getReservoirAmount = (deviceStatus: DeviceStatus | null): number | null => {
  if (!deviceStatus) {
    return null;
  }
  
  if (deviceStatus.pump?.reservoir !== undefined) {
    return deviceStatus.pump.reservoir;
  }
  
  return null;
};

/**
 * Get pump battery percentage
 */
export const getPumpBattery = (deviceStatus: DeviceStatus | null): number | null => {
  if (!deviceStatus) {
    return null;
  }
  
  if (deviceStatus.pump?.battery?.percent !== undefined) {
    return deviceStatus.pump.battery.percent;
  }
  
  return null;
};
