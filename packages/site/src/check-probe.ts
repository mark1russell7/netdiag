// The probe of the home page for `site-pages check`: it uses each demo as a visitor does, at each width of the check.
declare const check: (name: string, ok: boolean, detail?: unknown) => void;
declare const $: (selector: string) => HTMLElement | null;
declare const $$: (selector: string) => HTMLElement[];
declare const click: (element: Element | string | null) => void;
declare const until: (fn: () => unknown, ms?: number) => Promise<boolean>;

/** This function gives the text of an element, or an empty text. */
const text = (selector: string): string => $(selector)?.textContent ?? "";
/** This function finds a button of a row by its text. */
const chip = (row: string, label: string): HTMLElement | null => $$(`#${row} button`).find((element) => element.textContent === label) ?? null;
/** This function sets the value of a control and sends the input event, as a visitor does. */
const set = (selector: string, value: string): void => {
  const control = $(selector) as HTMLInputElement | HTMLSelectElement | null;
  if (control === null) return;
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
};
/** This function gives the id of the first cause of a list. */
const firstCause = (list: string): string => text(`#${list} li:first-child code`);

// 1. Name the cause
check("the board starts with no observations", text("#board-count") === "No observations.", text("#board-count"));
check("the board has a row for each layer", $$("#board-stack .layer").length === 9, $$("#board-stack .layer").length);
click(chip("board-chips", "The port refuses"));
check("a refused connect gives port.closed", await until(() => firstCause("board-causes") === "port.closed"), text("#board-verdict"));
check("the explanation names the refused connect", text("#board-why").includes("tcp.connect = refused"), text("#board-why"));
click(chip("board-chips", "A slow handshake on two hosts"));
check("a slow handshake on two hosts gives tls.proxy", await until(() => firstCause("board-causes") === "tls.proxy"), text("#board-verdict"));
check("the second host has two observations", text("#board-host").includes("A second host (2)"), text("#board-host"));
click($$("#board-causes button")[1] ?? null);
check("a click on the second cause explains it", await until(() => $$("#board-causes button")[1]?.getAttribute("aria-pressed") === "true"), text("#board-why"));
click("#board-clear");
click('#board-stack button[data-feature="tcp.connect"][data-value="refused"]');
check("a click on a value adds an observation", await until(() => text("#board-count") === "1 observation."), text("#board-count"));

// 2. Find a hidden fault
check("the search ranks the eight probes", $$("#search-probes .probe").length === 8 && $("#search-probes .probe.best") !== null, $$("#search-probes .probe").length);
check("the fault starts hidden", text("#search-result").includes("The fault is hidden"), text("#search-result"));
set("#search-truth", "tls.proxy");
click("#search-auto");
check("the search finds tls.proxy", await until(() => text("#search-result").includes("Found tls.proxy")), text("#search-result"));
check("the steps list each probe", $$("#search-steps .step").length > 0, $$("#search-steps .step").length);
click("#search-reset");
check("start again removes the steps", await until(() => text("#search-steps").includes("No probes yet")), text("#search-steps"));
click("#search-best");
check("the best probe runs once", await until(() => $$("#search-steps .step").length === 1), $$("#search-steps .step").length);

// 3. Score the catalog
check("the lab scores 420 runs", text("#lab-result").includes("420 runs"), text("#lab-result"));
check("the lab has a row for each hypothesis", $$("#lab-rows .recall").length === 22, $$("#lab-rows .recall").length);
for (const box of $$("#lab-probes input")) if ((box as HTMLInputElement).checked) click(box);
check("with no probe, the gate fails", await until(() => text("#lab-result").includes("No probe observes the network")), text("#lab-result"));
set("#lab-bar", "0");
check("with the bar 0, the gate passes", await until(() => text("#lab-result").includes("The gate passes")), text("#lab-result"));

export {};
