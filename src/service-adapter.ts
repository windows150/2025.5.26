import type { Service, ServiceClass, OpenClawPluginService, OpenClawPluginServiceContext } from "./eliza-types.js";
import type { RuntimeBridge } from "./runtime-bridge.js";

export type AdaptedService = OpenClawPluginService & { elizaServiceType: string };

export function adaptService(serviceClass: ServiceClass, bridge: RuntimeBridge): AdaptedService {
  let instance: Service | null = null;
  const serviceType = serviceClass.serviceType;

  return {
    id: `eliza:${serviceType}`,
    elizaServiceType: serviceType,

    async start(_ctx: OpenClawPluginServiceContext): Promise<void> {
      bridge.logger.info(`[eliza-adapter] Starting service: ${serviceType}`);
      instance = await serviceClass.start(bridge);
      bridge.injectService(serviceType, instance);
      if (serviceClass.registerSendHandlers) serviceClass.registerSendHandlers(bridge, instance);
      bridge.logger.info(`[eliza-adapter] Service started: ${serviceType}`);
    },

    async stop(_ctx: OpenClawPluginServiceContext): Promise<void> {
      bridge.logger.info(`[eliza-adapter] Stopping service: ${serviceType}`);
      if (instance) await instance.stop();
      if (serviceClass.stopRuntime) await serviceClass.stopRuntime(bridge);
      instance = null;
    },
  };
}
