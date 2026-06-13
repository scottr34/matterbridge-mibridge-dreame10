import { RvcCleanModeServer } from '@matter/node/behaviors/rvc-clean-mode';
import { RvcOperationalStateServer } from '@matter/node/behaviors/rvc-operational-state';
import { RvcRunModeServer } from '@matter/node/behaviors/rvc-run-mode';
import { ModeBase } from '@matter/types/clusters/mode-base';
import { OperationalState } from '@matter/types/clusters/operational-state';
import { PowerSource } from '@matter/types/clusters/power-source';
import { RvcCleanMode } from '@matter/types/clusters/rvc-clean-mode';
import { RvcOperationalState } from '@matter/types/clusters/rvc-operational-state';
import { RvcRunMode } from '@matter/types/clusters/rvc-run-mode';
import { ServiceArea } from '@matter/types/clusters/service-area';
import { MatterbridgeServer } from '../behaviors/matterbridgeServer.js';
import { MatterbridgeServiceAreaServer } from '../behaviors/serviceAreaServer.js';
import { powerSource, roboticVacuumCleaner } from '../matterbridgeDeviceTypes.js';
import { MatterbridgeEndpoint } from '../matterbridgeEndpoint.js';
export class RoboticVacuumCleaner extends MatterbridgeEndpoint {
    constructor(name, serial, mode = undefined, currentRunMode, supportedRunModes, currentCleanMode, supportedCleanModes, currentPhase = null, phaseList = null, operationalState, operationalStateList, supportedAreas, selectedAreas, currentArea, supportedMaps) {
        super([roboticVacuumCleaner, powerSource], { id: `${name.replaceAll(' ', '')}-${serial.replaceAll(' ', '')}`, mode });
        this.createDefaultIdentifyClusterServer()
            .createDefaultBasicInformationClusterServer(name, serial, 0xfff1, 'Matterbridge', 0x8000, 'Matterbridge Robot Vacuum Cleaner')
            .createDefaultPowerSourceRechargeableBatteryClusterServer(80, PowerSource.BatChargeLevel.Ok, 5900)
            .createDefaultRvcRunModeClusterServer(currentRunMode, supportedRunModes)
            .createDefaultRvcCleanModeClusterServer(currentCleanMode, supportedCleanModes)
            .createDefaultRvcOperationalStateClusterServer(phaseList, currentPhase, operationalStateList, operationalState)
            .createDefaultServiceAreaClusterServer(supportedAreas, selectedAreas, currentArea, supportedMaps);
    }
    createDefaultRvcRunModeClusterServer(currentMode, supportedModes) {
        this.behaviors.require(MatterbridgeRvcRunModeServer, {
            supportedModes: supportedModes ?? [
                { label: 'Idle', mode: 1, modeTags: [{ value: RvcRunMode.ModeTag.Idle }] },
                { label: 'Cleaning', mode: 2, modeTags: [{ value: RvcRunMode.ModeTag.Cleaning }] },
                { label: 'Mapping', mode: 3, modeTags: [{ value: RvcRunMode.ModeTag.Mapping }] },
                { label: 'SpotCleaning', mode: 4, modeTags: [{ value: RvcRunMode.ModeTag.Cleaning }, { value: RvcRunMode.ModeTag.Max }] },
            ],
            currentMode: currentMode ?? 1,
        });
        return this;
    }
    createDefaultRvcCleanModeClusterServer(currentMode, supportedModes) {
        this.behaviors.require(MatterbridgeRvcCleanModeServer, {
            supportedModes: supportedModes ?? [
                { label: 'Vacuum', mode: 1, modeTags: [{ value: RvcCleanMode.ModeTag.Vacuum }] },
                { label: 'Mop', mode: 2, modeTags: [{ value: RvcCleanMode.ModeTag.Mop }] },
                { label: 'DeepClean', mode: 3, modeTags: [{ value: RvcCleanMode.ModeTag.DeepClean }] },
            ],
            currentMode: currentMode ?? 1,
        });
        return this;
    }
    createDefaultServiceAreaClusterServer(supportedAreas, selectedAreas, currentArea, supportedMaps) {
        this.behaviors.require(MatterbridgeServiceAreaServer.with(ServiceArea.Feature.Maps, ServiceArea.Feature.ProgressReporting), {
            supportedAreas: supportedAreas ?? [
                {
                    areaId: 1,
                    mapId: null,
                    areaInfo: { locationInfo: { locationName: 'Living', floorNumber: 0, areaType: null }, landmarkInfo: null },
                },
                {
                    areaId: 2,
                    mapId: null,
                    areaInfo: { locationInfo: { locationName: 'Kitchen', floorNumber: 0, areaType: null }, landmarkInfo: null },
                },
                {
                    areaId: 3,
                    mapId: null,
                    areaInfo: { locationInfo: { locationName: 'Bedroom', floorNumber: 1, areaType: null }, landmarkInfo: null },
                },
                {
                    areaId: 4,
                    mapId: null,
                    areaInfo: { locationInfo: { locationName: 'Bathroom', floorNumber: 1, areaType: null }, landmarkInfo: null },
                },
            ],
            selectedAreas: selectedAreas ?? [],
            currentArea: currentArea !== undefined ? currentArea : 1,
            supportedMaps: supportedMaps ?? [],
            estimatedEndTime: null,
            progress: [],
        });
        return this;
    }
    createDefaultRvcOperationalStateClusterServer(phaseList = null, currentPhase = null, operationalStateList, operationalState, operationalError) {
        this.behaviors.require(MatterbridgeRvcOperationalStateServer, {
            phaseList,
            currentPhase,
            operationalStateList: operationalStateList ?? [
                { operationalStateId: RvcOperationalState.OperationalState.Stopped },
                { operationalStateId: RvcOperationalState.OperationalState.Running },
                { operationalStateId: RvcOperationalState.OperationalState.Paused },
                { operationalStateId: RvcOperationalState.OperationalState.Error },
                { operationalStateId: RvcOperationalState.OperationalState.SeekingCharger },
                { operationalStateId: RvcOperationalState.OperationalState.Charging },
                { operationalStateId: RvcOperationalState.OperationalState.Docked },
            ],
            operationalState: operationalState ?? RvcOperationalState.OperationalState.Docked,
            operationalError: operationalError ?? { errorStateId: RvcOperationalState.ErrorState.NoError, errorStateDetails: 'Fully operational' },
        });
        return this;
    }
}
export class MatterbridgeRvcRunModeServer extends RvcRunModeServer {
    async changeToMode(request) {
        const device = this.endpoint.stateOf(MatterbridgeServer);
        device.log.info(`Changing mode to ${request.newMode} (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`);
        await device.commandHandler.executeHandler('RvcRunMode.changeToMode', {
            command: 'changeToMode',
            request,
            cluster: RvcRunModeServer.id,
            attributes: this.state,
            endpoint: this.endpoint,
        });
        const supported = this.state.supportedModes.find((mode) => mode.mode === request.newMode);
        if (!supported) {
            device.log.error(`MatterbridgeRvcRunModeServer changeToMode called with unsupported newMode: ${request.newMode}`);
            return { status: ModeBase.ModeChangeStatus.UnsupportedMode, statusText: 'Unsupported mode' };
        }
        this.state.currentMode = request.newMode;
        if (supported.modeTags.find((tag) => tag.value === RvcRunMode.ModeTag.Cleaning)) {
            device.log.debug('MatterbridgeRvcRunModeServer changeToMode called with newMode Cleaning => Running');
            this.agent.get(MatterbridgeRvcOperationalStateServer).state.operationalState = RvcOperationalState.OperationalState.Running;
            return { status: ModeBase.ModeChangeStatus.Success, statusText: 'Running' };
        }
        else if (supported.modeTags.find((tag) => tag.value === RvcRunMode.ModeTag.Idle)) {
            device.log.debug('MatterbridgeRvcRunModeServer changeToMode called with newMode Idle => Docked');
            this.agent.get(MatterbridgeRvcOperationalStateServer).state.operationalState = RvcOperationalState.OperationalState.Docked;
            return { status: ModeBase.ModeChangeStatus.Success, statusText: 'Docked' };
        }
        device.log.debug(`MatterbridgeRvcRunModeServer changeToMode called with newMode ${request.newMode} => ${supported.label}`);
        this.agent.get(MatterbridgeRvcOperationalStateServer).state.operationalState = RvcOperationalState.OperationalState.Running;
        return { status: ModeBase.ModeChangeStatus.Success, statusText: 'Success' };
    }
}
export class MatterbridgeRvcCleanModeServer extends RvcCleanModeServer {
    async changeToMode(request) {
        const device = this.endpoint.stateOf(MatterbridgeServer);
        device.log.info(`Changing mode to ${request.newMode} (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`);
        await device.commandHandler.executeHandler('RvcCleanMode.changeToMode', {
            command: 'changeToMode',
            request,
            cluster: RvcCleanModeServer.id,
            attributes: this.state,
            endpoint: this.endpoint,
        });
        const supported = this.state.supportedModes.find((mode) => mode.mode === request.newMode);
        if (!supported) {
            device.log.error(`MatterbridgeRvcCleanModeServer changeToMode called with unsupported newMode: ${request.newMode}`);
            return { status: ModeBase.ModeChangeStatus.UnsupportedMode, statusText: 'Unsupported mode' };
        }
        this.state.currentMode = request.newMode;
        device.log.debug(`MatterbridgeRvcCleanModeServer changeToMode called with newMode ${request.newMode} => ${supported.label}`);
        return { status: ModeBase.ModeChangeStatus.Success, statusText: 'Success' };
    }
}
export class MatterbridgeRvcOperationalStateServer extends RvcOperationalStateServer {
    async pause() {
        const device = this.endpoint.stateOf(MatterbridgeServer);
        device.log.info(`Pause (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`);
        await device.commandHandler.executeHandler('RvcOperationalState.pause', {
            command: 'pause',
            request: {},
            cluster: RvcOperationalStateServer.id,
            attributes: this.state,
            endpoint: this.endpoint,
        });
        device.log.debug('MatterbridgeRvcOperationalStateServer: pause called setting operational state to Paused and currentMode to Idle');
        this.agent.get(MatterbridgeRvcRunModeServer).state.currentMode = 1;
        this.state.operationalState = RvcOperationalState.OperationalState.Paused;
        this.state.operationalError = { errorStateId: RvcOperationalState.ErrorState.NoError, errorStateDetails: 'Fully operational' };
        return {
            commandResponseState: { errorStateId: OperationalState.ErrorState.NoError, errorStateDetails: 'Fully operational' },
        };
    }
    async resume() {
        const device = this.endpoint.stateOf(MatterbridgeServer);
        device.log.info(`Resume (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`);
        await device.commandHandler.executeHandler('RvcOperationalState.resume', {
            command: 'resume',
            request: {},
            cluster: RvcOperationalStateServer.id,
            attributes: this.state,
            endpoint: this.endpoint,
        });
        device.log.debug('MatterbridgeRvcOperationalStateServer: resume called setting operational state to Running and currentMode to Cleaning');
        this.agent.get(MatterbridgeRvcRunModeServer).state.currentMode = 2;
        this.state.operationalState = RvcOperationalState.OperationalState.Running;
        this.state.operationalError = { errorStateId: RvcOperationalState.ErrorState.NoError, errorStateDetails: 'Fully operational' };
        return {
            commandResponseState: { errorStateId: OperationalState.ErrorState.NoError, errorStateDetails: 'Fully operational' },
        };
    }
    async goHome() {
        const device = this.endpoint.stateOf(MatterbridgeServer);
        device.log.info(`GoHome (endpoint ${this.endpoint.maybeId}.${this.endpoint.maybeNumber})`);
        await device.commandHandler.executeHandler('RvcOperationalState.goHome', {
            command: 'goHome',
            request: {},
            cluster: RvcOperationalStateServer.id,
            attributes: this.state,
            endpoint: this.endpoint,
        });
        device.log.debug('MatterbridgeRvcOperationalStateServer: goHome called setting operational state to Docked and currentMode to Idle');
        this.agent.get(MatterbridgeRvcRunModeServer).state.currentMode = 1;
        this.state.operationalState = RvcOperationalState.OperationalState.Docked;
        this.state.operationalError = { errorStateId: RvcOperationalState.ErrorState.NoError, errorStateDetails: 'Fully operational' };
        return {
            commandResponseState: { errorStateId: OperationalState.ErrorState.NoError, errorStateDetails: 'Fully operational' },
        };
    }
}
