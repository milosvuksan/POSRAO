import { Scheduler } from './scheduler.js';
export declare function createApp(scheduler: Scheduler, production?: boolean): {
    app: import("express-serve-static-core").Express;
    broadcast: (snapshot?: import("./scheduler.js").PublicState) => void;
};
