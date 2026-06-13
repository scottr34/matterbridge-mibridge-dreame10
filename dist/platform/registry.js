import { FanAccessory } from '../devices/fan/FanAccessory.js';
import { FanService } from '../devices/fan/FanService.js';
import { FountainAccessory } from '../devices/fountain/FountainAccessory.js';
import { FountainService } from '../devices/fountain/FountainService.js';
import { VacuumAccessory } from '../devices/vacuum/VacuumAccessory.js';
import { VacuumService } from '../devices/vacuum/VacuumService.js';
export const registry = [
    { ServiceClass: VacuumService, AccessoryClass: VacuumAccessory },
    { ServiceClass: FountainService, AccessoryClass: FountainAccessory },
    { ServiceClass: FanService, AccessoryClass: FanAccessory },
];
