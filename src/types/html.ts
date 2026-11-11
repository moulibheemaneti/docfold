/** Values the `html` template tag accepts. */

import type { SafeHtml } from "../shared/html";

export type HtmlValue = SafeHtml | string | number | boolean | null | undefined | readonly HtmlValue[];
