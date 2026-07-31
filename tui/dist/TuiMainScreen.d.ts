import { type TUI, TuiBase } from "./tui.ts";
/** TUI implementation that renders into the terminal's main screen and scrollback. */
export declare class TuiMainScreen extends TuiBase implements TUI {
    private previousLines;
    private previousKittyImageIds;
    private previousWidth;
    private previousHeight;
    private cursorRow;
    private hardwareCursorRow;
    private maxLinesRendered;
    private previousViewportTop;
    protected resetRenderState(): void;
    protected beforeTerminalStop(): void;
    private collectKittyImageIds;
    private deleteKittyImages;
    private getKittyImageReservedRows;
    private expandChangedRangeForKittyImages;
    private deleteChangedKittyImages;
    protected doRender(): void;
    /**
     * Position the hardware cursor for IME candidate window.
     * @param cursorPos The cursor position extracted from rendered output, or null
     * @param totalLines Total number of rendered lines
     */
    private positionHardwareCursor;
}
