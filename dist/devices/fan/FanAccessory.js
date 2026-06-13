import { fanDevice, MatterbridgeEndpoint, MatterbridgeFanControlServer } from 'matterbridge';
import { BaseDeviceAccessory } from '../../platform/DeviceAccessory.js';
const MatterFanMode = { Off: 0, Low: 1, Medium: 2, High: 3 };
const LEVEL_THRESHOLDS = { low: 33, mid: 66 };
const LEVEL_PERCENT = { off: 0, low: 25, medium: 50, high: 75 };
const ROCK_OFF = { rockLeftRight: false, rockUpDown: false, rockRound: false };
export class FanAccessory extends BaseDeviceAccessory {
    async register(platform, device, client) {
        const fanClient = client;
        const did = device.did;
        const endpoint = new MatterbridgeEndpoint([fanDevice], { id: `${device.name.replaceAll(' ', '')}-${did}` });
        const FanControlServer = Object.getPrototypeOf(Object.getPrototypeOf(MatterbridgeFanControlServer));
        const RockingFanControlServer = FanControlServer.with('Rocking');
        endpoint.createDefaultIdentifyClusterServer().createDefaultBridgedDeviceBasicInformationClusterServer(device.name, did, 0xfff1, 'Matterbridge', 'Matterbridge Fan');
        endpoint.behaviors.require(RockingFanControlServer, {
            fanMode: 0,
            fanModeSequence: 0,
            percentSetting: 0,
            percentCurrent: 0,
            rockSupport: { rockLeftRight: true, rockUpDown: false, rockRound: false },
            rockSetting: { ...ROCK_OFF },
        });
        platform.setSelectDevice(did, device.name);
        const selected = platform.validateDevice([device.name, did]);
        if (!selected) {
            this.log.debug(`[${did}] Fan excluded by white/blacklist`);
            return null;
        }
        await platform.registerDevice(endpoint);
        this.log.info(`Registered fan: ${device.name} (${did})`);
        await endpoint.subscribeAttribute('fanControl', 'percentSetting', async (newValue, _oldValue, context) => {
            if (context.offline === true)
                return;
            this.log.info(`[${did}] percentSetting changed to ${newValue}`);
            try {
                await this.applyPercent(fanClient, newValue);
            }
            catch (err) {
                this.log.error(`[${did}] Failed to apply percentSetting ${newValue}: ${err}`);
            }
        }, this.log);
        await endpoint.subscribeAttribute('fanControl', 'rockSetting', async (newValue, _oldValue, context) => {
            if (context.offline === true)
                return;
            this.log.info(`[${did}] rockSetting changed to ${JSON.stringify(newValue)}`);
            try {
                await fanClient.setOscillating(newValue.rockLeftRight);
            }
            catch (err) {
                this.log.error(`[${did}] Failed to apply rockSetting: ${err}`);
            }
        }, this.log);
        fanClient.on('statusChange', (status) => {
            if (this.verbose) {
                this.log.info(`[${did}] Status: on=${status.on}, speed=${JSON.stringify(status.speed)}, oscillating=${status.oscillating}`);
            }
            else {
                this.log.debug(`[${did}] Status update received`);
            }
            this.syncState(endpoint, status);
        });
        fanClient.on('error', (err) => {
            this.log.error(`[${did}] Fan error: ${err.message}`);
        });
        fanClient.on('connected', () => {
            this.log.info(`[${did}] Fan client connected`);
        });
        fanClient.on('disconnected', () => {
            this.log.warn(`[${did}] Fan client disconnected`);
        });
        const initialStatus = await fanClient.getStatus();
        this.syncState(endpoint, initialStatus);
        return endpoint;
    }
    syncState(endpoint, status) {
        const percent = this.statusToPercent(status);
        const fanMode = this.statusToFanMode(status);
        const rockSetting = { ...ROCK_OFF, rockLeftRight: status.oscillating };
        endpoint.setAttribute('fanControl', 'fanMode', fanMode);
        endpoint.setAttribute('fanControl', 'percentSetting', percent);
        endpoint.setAttribute('fanControl', 'percentCurrent', percent);
        endpoint.setAttribute('fanControl', 'rockSetting', rockSetting);
    }
    statusToPercent(status) {
        if (!status.on)
            return LEVEL_PERCENT.off;
        const speed = status.speed;
        if (speed.type === 'level') {
            if (speed.value === 1)
                return LEVEL_PERCENT.low;
            if (speed.value === 2)
                return LEVEL_PERCENT.medium;
            if (speed.value >= 3)
                return LEVEL_PERCENT.high;
        }
        return LEVEL_PERCENT.medium;
    }
    statusToFanMode(status) {
        if (!status.on)
            return MatterFanMode.Off;
        const speed = status.speed;
        if (speed.type === 'level') {
            if (speed.value === 1)
                return MatterFanMode.Low;
            if (speed.value === 2)
                return MatterFanMode.Medium;
            if (speed.value >= 3)
                return MatterFanMode.High;
        }
        return MatterFanMode.Medium;
    }
    async applyPercent(client, percent) {
        if (percent === 0) {
            await client.setOn(false);
            return;
        }
        await client.setOn(true);
        if (percent <= LEVEL_THRESHOLDS.low) {
            await client.setSpeed({ type: 'level', value: 1 });
        }
        else if (percent <= LEVEL_THRESHOLDS.mid) {
            await client.setSpeed({ type: 'level', value: 2 });
        }
        else {
            await client.setSpeed({ type: 'level', value: 3 });
        }
    }
}
