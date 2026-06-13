import { FountainFaultCode, FountainMode } from '@mibridge/core';
import { airPurifier, MatterbridgeEndpoint, powerSource } from 'matterbridge';
import { BaseDeviceAccessory } from '../../platform/DeviceAccessory.js';
const FanMode = { Off: 0, Low: 1, Medium: 2, High: 3, On: 4, Auto: 5 };
export class FountainAccessory extends BaseDeviceAccessory {
    async register(platform, device, client) {
        const fountainClient = client;
        const did = device.did;
        const endpoint = new MatterbridgeEndpoint([airPurifier, powerSource], { id: `${device.name.replaceAll(' ', '')}-${did}` });
        endpoint
            .createDefaultIdentifyClusterServer()
            .createDefaultBridgedDeviceBasicInformationClusterServer(device.name, did, 0xfff1, 'Matterbridge', 'Matterbridge Pet Fountain')
            .createDefaultPowerSourceRechargeableBatteryClusterServer(200)
            .createDefaultFanControlClusterServer()
            .createDefaultActivatedCarbonFilterMonitoringClusterServer(100, 0)
            .createDefaultBooleanStateClusterServer(false);
        endpoint.addCommandHandler('resetCondition', async () => {
            this.log.info(`[${did}] resetCondition (filter reset) command received`);
            try {
                await fountainClient.resetFilter();
                this.log.info(`[${did}] Filter reset successful`);
            }
            catch (err) {
                this.log.error(`[${did}] Failed to reset filter: ${err}`);
                throw err;
            }
        });
        fountainClient.on('statusChange', (status) => {
            if (this.verbose) {
                this.log.info(`[${did}] Status update: on=${status.on}, battery=${status.batteryLevel}%, filter=${status.filterLifeLeft}%, fault=${status.fault}`);
            }
            else {
                this.log.debug(`[${did}] Status update received`);
            }
            this.syncState(endpoint, status, did);
        });
        fountainClient.on('error', (err) => {
            this.log.error(`[${did}] Fountain error: ${err.message}`);
        });
        fountainClient.on('connected', () => {
            this.log.info(`[${did}] Fountain client connected`);
        });
        fountainClient.on('disconnected', () => {
            this.log.warn(`[${did}] Fountain client disconnected`);
        });
        platform.setSelectDevice(did, device.name);
        const selected = platform.validateDevice([device.name, did]);
        if (!selected) {
            this.log.debug(`[${did}] Fountain excluded by white/blacklist`);
            return null;
        }
        await platform.registerDevice(endpoint);
        this.log.info(`Registered fountain: ${device.name} (${did})`);
        await endpoint.subscribeAttribute('fanControl', 'fanMode', async (newValue, _oldValue, context) => {
            if (context.offline === true)
                return;
            this.log.info(`[${did}] fanMode changed to ${newValue}`);
            try {
                if (newValue === FanMode.Off) {
                    await fountainClient.setOn(false);
                }
                else {
                    await fountainClient.setOn(true);
                    const mode = this.fanModeToFountainMode(newValue);
                    if (mode)
                        await fountainClient.setMode(mode);
                }
            }
            catch (err) {
                this.log.error(`[${did}] Failed to apply fanMode ${newValue}: ${err}`);
            }
        }, this.log);
        const initialStatus = await fountainClient.getStatus();
        this.syncState(endpoint, initialStatus, did);
        return endpoint;
    }
    syncState(endpoint, status, did) {
        endpoint.setAttribute('fanControl', 'fanMode', this.fountainModeToFanMode(status.on, status.mode));
        endpoint.setAttribute('powerSource', 'batPercentRemaining', Math.floor(status.batteryLevel * 2));
        endpoint.setAttribute('activatedCarbonFilterMonitoring', 'condition', status.filterLifeLeft);
        endpoint.setAttribute('activatedCarbonFilterMonitoring', 'changeIndication', this.filterIndication(status.fault, status.filterLifeLeft));
        const shortage = status.waterShortage || status.fault === FountainFaultCode.LidRemoved;
        endpoint.setAttribute('booleanState', 'stateValue', shortage);
        if (status.fault === FountainFaultCode.PumpBlocked) {
            this.log.warn(`[${did}] Pump blocked — check fountain for obstruction`);
        }
    }
    fountainModeToFanMode(on, mode) {
        if (!on)
            return FanMode.Off;
        if (mode === 'intermittent')
            return FanMode.Low;
        if (mode === 'sensor')
            return FanMode.Auto;
        return FanMode.High;
    }
    fanModeToFountainMode(fanMode) {
        if (fanMode === FanMode.Low)
            return FountainMode.Intermittent;
        if (fanMode === FanMode.Auto)
            return FountainMode.Sensor;
        if (fanMode === FanMode.Medium || fanMode === FanMode.High || fanMode === FanMode.On)
            return FountainMode.Continuous;
        return null;
    }
    filterIndication(fault, filterLifeLeft) {
        if (fault === FountainFaultCode.FilterExpired)
            return 2;
        if (filterLifeLeft <= 10)
            return 2;
        if (filterLifeLeft <= 30)
            return 1;
        return 0;
    }
}
