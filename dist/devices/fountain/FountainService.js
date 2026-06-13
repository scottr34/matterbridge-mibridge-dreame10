import { PetFountainClient } from '@mibridge/core';
import { BaseDeviceService } from '../../platform/DeviceService.js';
export class FountainService extends BaseDeviceService {
    modelPatterns = ['pet_waterer'];
    clients = new Map();
    devices = [];
    async connect(allDevices) {
        const fountains = allDevices.filter((d) => this.modelPatterns.some((p) => d.model.includes(p)));
        this.log.info(`Found ${fountains.length} fountain device(s): ${fountains.map((f) => `${f.name} (${f.model})`).join(', ')}`);
        for (const device of fountains) {
            const client = new PetFountainClient({
                deviceId: device.did,
                region: this.config.region ?? 'de',
                pollInterval: this.config.pollInterval ?? 30_000,
                session: this.config.session,
            });
            this.clients.set(device.did, client);
            this.devices.push(device);
            this.log.debug(`Created fountain client for ${device.name} (${device.did})`);
        }
    }
    getDevices() {
        return [...this.devices];
    }
    async connectDevice(did) {
        const client = this.clients.get(did);
        if (!client)
            throw new Error(`No fountain client for device ${did}`);
        if (!client.isConnected()) {
            this.log.info(`Connecting fountain ${did}...`);
            await client.connect();
            this.log.info(`Fountain ${did} connected`);
        }
        return client;
    }
    async disconnect() {
        for (const [did, client] of this.clients.entries()) {
            try {
                if (client.isConnected()) {
                    await client.disconnect();
                    this.log.debug(`Disconnected fountain ${did}`);
                }
            }
            catch (err) {
                this.log.error(`Error disconnecting fountain ${did}: ${err}`);
            }
        }
        this.clients.clear();
        this.devices = [];
        this.log.info('FountainService disconnected');
    }
}
