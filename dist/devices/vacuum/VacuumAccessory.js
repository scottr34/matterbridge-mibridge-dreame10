import { CleanMode, VacuumErrorCode, VacuumState } from '@mibridge/core';
import { MatterbridgeEndpoint, onOffLight } from 'matterbridge';
import { RoboticVacuumCleaner } from 'matterbridge/devices';
import { BaseDeviceAccessory } from '../../platform/DeviceAccessory.js';
export class VacuumAccessory extends BaseDeviceAccessory {
    async register(platform, device, client) {
        const vacuumClient = client;
        const did = device.did;
        this.log.info(`[${did}] Loading maps and areas...`);
        const maps = await vacuumClient.getMaps();
        this.log.info(`[${did}] Found ${maps.length} map(s)`);
        this.log.info(`[${did}] RAW maps: ${JSON.stringify(maps)}`);
        const areas = maps.length > 0 ? maps[0].areas : [];
        this.log.info(`[${did}] Found ${areas.length} area(s): ${areas.map((a) => a.name).join(', ')}`);
        this.log.info(`[${did}] RAW areas: ${JSON.stringify(areas)}`);
        const roomRenames = {};
        for (const entry of (platform.config.roomNames ?? [])) {
            if (entry.from && entry.to) {
                roomRenames[entry.from] = entry.to;
            }
        }
        const supportedAreas = areas.map((area, index) => {
            const areaIdParsed = parseInt(area.id, 10);
            const locationName = roomRenames[area.name] ?? area.name;
            if (roomRenames[area.name]) {
                this.log.info(`[${did}] Room rename: '${area.name}' → '${locationName}'`);
            }
            return {
                areaId: isNaN(areaIdParsed) ? index + 1 : areaIdParsed,
                mapId: area.mapId ? parseInt(area.mapId, 10) : null,
                areaInfo: {
                    locationInfo: { locationName, floorNumber: null, areaType: null },
                    landmarkInfo: null,
                },
            };
        });
        const supportedMaps = maps.map((map) => {
            const mapIdParsed = parseInt(map.id, 10);
            return {
                mapId: isNaN(mapIdParsed) ? 1 : mapIdParsed,
                name: map.name,
            };
        });
        const vacuum = new RoboticVacuumCleaner(device.name, did, 'server', 1, undefined, 1, undefined, null, null, 0x42, undefined, supportedAreas, [], null, supportedMaps.length > 0 ? supportedMaps : undefined);
        this.log.info(`[${did}] Created vacuum with ${supportedAreas.length} area(s)`);
        await this.detectAndConfigureMopCapabilities(did, vacuumClient, vacuum);
        if (this.verbose) {
            await this.displayVerboseInfo(device, vacuumClient, maps, areas, supportedAreas);
        }
        const switchEndpoint = new MatterbridgeEndpoint([onOffLight], {
            id: `${device.name.replaceAll(' ', '')}-cleaning-${did.replaceAll(' ', '')}`,
        });
        switchEndpoint
            .createDefaultIdentifyClusterServer()
            .createDefaultBridgedDeviceBasicInformationClusterServer(
                `${device.name} Cleaning`,
                `${did}-sw`,
                0xfff1,
                'Matterbridge',
                'Vacuum Cleaning Switch',
            )
            .createDefaultOnOffClusterServer();
        this.setupCommandHandlers(vacuum, vacuumClient, did);
        this.setupEventListeners(vacuum, vacuumClient, did, switchEndpoint);
        platform.setSelectDevice(did, device.name);
        const selected = platform.validateDevice([device.name, did]);
        if (!selected) {
            this.log.debug(`[${did}] Vacuum excluded by white/blacklist`);
            return null;
        }
        await platform.registerDevice(vacuum);
        await platform.registerDevice(switchEndpoint);
        this.log.info(`Registered vacuum: ${device.name}`);
        this.log.info(`Registered cleaning switch for: ${device.name}`);
        return vacuum;
    }
    setupCommandHandlers(vacuum, client, did) {
        vacuum.addCommandHandler('RvcOperationalState.goHome', async () => {
            this.log.info(`[${did}] goHome command received`);
            try {
                await client.returnToDock();
            }
            catch (err) {
                this.log.error(`[${did}] goHome failed: ${err}`);
                throw err;
            }
        });
        vacuum.addCommandHandler('RvcOperationalState.resume', async () => {
            this.log.info(`[${did}] resume command received`);
            try {
                await client.resume();
            }
            catch (err) {
                this.log.error(`[${did}] resume failed: ${err}`);
                throw err;
            }
        });
        vacuum.addCommandHandler('RvcOperationalState.pause', async () => {
            this.log.info(`[${did}] pause command received`);
            try {
                await client.pause();
            }
            catch (err) {
                this.log.error(`[${did}] pause failed: ${err}`);
                throw err;
            }
        });
        let selectedAreaIds = [];
        vacuum.addCommandHandler('ServiceArea.selectAreas', async ({ request }) => {
            selectedAreaIds = request.newAreas?.map((a) => String(a)) || [];
            this.log.info(`[${did}] selectAreas: ${JSON.stringify(selectedAreaIds)}`);
        });
        vacuum.addCommandHandler('RvcRunMode.changeToMode', async ({ request }) => {
            const mode = request.newMode;
            this.log.info(`[${did}] changeToMode: ${mode}`);
            try {
                if (mode === 1) {
                    // Idle → stop
                    await client.stop();
                }
                else if (mode === 2 || mode === 4) {
                    // Cleaning (2) or SpotCleaning (4) → area clean or full clean
                    if (selectedAreaIds.length > 0) {
                        await client.startCleaningAreas(selectedAreaIds);
                    }
                    else {
                        await client.start();
                    }
                }
                else if (mode === 3) {
                    // Mapping mode → start mapping run
                    await client.startMapping();
                }
            }
            catch (err) {
                this.log.error(`[${did}] changeToMode failed: ${err}`);
                throw err;
            }
        });
        vacuum.addCommandHandler('RvcCleanMode.changeToMode', async ({ request }) => {
            const mode = request.newMode;
            const modeMap = {
                1: CleanMode.Vacuum,
                2: CleanMode.Mop,
                3: CleanMode.VacuumThenMop,
            };
            if (mode in modeMap) {
                try {
                    await client.setCleanMode(modeMap[mode]);
                }
                catch (err) {
                    this.log.error(`[${did}] setCleanMode failed: ${err}`);
                    throw err;
                }
            }
        });
    }
    setupEventListeners(vacuum, client, did, switchEndpoint) {
        let lastMopPresent = null;
        client.on('statusChange', async (status) => {
            if (this.verbose) {
                this.log.info(`[${did}] Status: state=${status.state}, battery=${status.batteryLevel}%`);
            }
            if (status.batteryLevel !== undefined) {
                try {
                    await vacuum.setAttribute('PowerSource', 'batPercentRemaining', Math.floor((status.batteryLevel / 100) * 200));
                }
                catch (err) {
                    this.log.debug(`[${did}] Could not update battery: ${err}`);
                }
            }
            if (status.state !== undefined) {
                try {
                    await vacuum.setAttribute('RvcOperationalState', 'operationalState', this.mapState(status.state));
                }
                catch (err) {
                    this.log.debug(`[${did}] Could not update operational state: ${err}`);
                }
                if (status.state === VacuumState.Docked || status.state === VacuumState.Idle) {
                    try {
                        await vacuum.setAttribute('RvcRunMode', 'currentMode', 1);
                    }
                    catch (err) {
                        this.log.debug(`[${did}] Could not reset run mode: ${err}`);
                    }
                    try {
                        await vacuum.setAttribute('ServiceArea', 'selectedAreas', []);
                    }
                    catch (err) {
                        this.log.debug(`[${did}] Could not clear selected areas: ${err}`);
                    }
                }
                // ON while a job is in progress (including paused); OFF when docked/idle/returning
                const isActive = status.state === VacuumState.Cleaning ||
                    status.state === VacuumState.Mapping ||
                    status.state === VacuumState.Paused;
                try {
                    await switchEndpoint.setAttribute('onOff', 'onOff', isActive);
                }
                catch (err) {
                    this.log.debug(`[${did}] Could not update cleaning switch: ${err}`);
                }
            }
            const mopMissing = status.errorCode === VacuumErrorCode.MopPadMissing;
            const waterMissing = status.errorCode === VacuumErrorCode.WaterTankMissing || status.errorCode === VacuumErrorCode.WaterTankEmpty;
            const currentMopPresent = !mopMissing && !waterMissing;
            if (lastMopPresent !== null && lastMopPresent !== currentMopPresent) {
                this.log.info(`[${did}] Mop pad ${currentMopPresent ? 'detected' : 'removed'} — reconfiguring modes`);
                await this.detectAndConfigureMopCapabilities(did, client, vacuum);
            }
            lastMopPresent = currentMopPresent;
        });
        client.on('error', (err) => {
            this.log.error(`[${did}] Vacuum error: ${err}`);
        });
        client.on('connected', () => {
            this.log.info(`[${did}] Vacuum client connected`);
        });
        client.on('disconnected', () => {
            this.log.warn(`[${did}] Vacuum client disconnected`);
        });
    }
    mapState(state) {
        const map = {
            [VacuumState.Idle]: 0x00,
            [VacuumState.Cleaning]: 0x01,
            [VacuumState.Mapping]: 0x01,
            [VacuumState.Returning]: 0x40,
            [VacuumState.Docked]: 0x42,
            [VacuumState.Paused]: 0x02,
            [VacuumState.Error]: 0x03,
        };
        return map[state] ?? 0x00;
    }
    async detectAndConfigureMopCapabilities(did, client, vacuum) {
        try {
            const status = await client.getStatus();
            const supportedModes = await client.getSupportedCleanModes();
            const mopMissing = status.errorCode === VacuumErrorCode.MopPadMissing;
            const waterMissing = status.errorCode === VacuumErrorCode.WaterTankMissing || status.errorCode === VacuumErrorCode.WaterTankEmpty;
            const hasMop = status.waterLevel && status.waterLevel !== 'off';
            let configuredModes;
            if (mopMissing || waterMissing) {
                configuredModes = [CleanMode.Vacuum];
            }
            else if (hasMop || supportedModes.includes(CleanMode.Mop)) {
                configuredModes = supportedModes;
            }
            else {
                configuredModes = [CleanMode.Vacuum];
            }
            const modeLabels = {
                [CleanMode.Vacuum]: 'Vacuum',
                [CleanMode.Mop]: 'Mop',
                [CleanMode.VacuumThenMop]: 'Vacuum + Mop',
            };
            const cleanModeOptions = configuredModes.map((mode, index) => ({
                label: modeLabels[mode] || mode,
                mode: index + 1,
                modeTags: [{ value: index + 1 }],
            }));
            try {
                vacuum.createDefaultRvcCleanModeClusterServer(1, cleanModeOptions);
            }
            catch (err) {
                this.log.debug(`[${did}] Could not update clean modes: ${err}`);
            }
        }
        catch (err) {
            this.log.warn(`[${did}] Could not detect mop capabilities: ${err}`);
        }
    }
    async displayVerboseInfo(device, client, maps, areas, supportedAreas) {
        this.log.info(`\n${'='.repeat(80)}`);
        this.log.info(`VERBOSE MODE — ${device.name}`);
        this.log.info(`${'='.repeat(80)}\n`);
        try {
            const info = await client.getInfo();
            this.log.info(`Model: ${info.model} | FW: ${info.firmwareVersion} | SN: ${info.serialNumber}`);
        }
        catch (_err) {
        }
        try {
            const status = await client.getStatus();
            this.log.info(`State: ${status.state} | Battery: ${status.batteryLevel}% | Clean: ${status.cleanMode}`);
        }
        catch (_err) {
        }
        this.log.info(`Maps: ${maps.length} | Areas: ${areas.length} | Matter areas: ${supportedAreas.length}`);
        this.log.info(`${'='.repeat(80)}\n`);
    }
}
