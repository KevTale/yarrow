/** noVNC ships no types: the part of its API the stage uses (docs/API.md). */
declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      url: string,
      options?: { shared?: boolean; wsProtocols?: string[] },
    );
    viewOnly: boolean;
    scaleViewport: boolean;
    background: string;
    disconnect(): void;
  }
}
