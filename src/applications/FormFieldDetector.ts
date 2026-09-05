import { Page } from "playwright";

export type ApplicationFieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "unknown";

export interface ApplicationField {
  name: string;
  type: ApplicationFieldType;
  required: boolean;
  label: string | null;
  placeholder: string | null;
}

export class FormFieldDetector {
  async detect(page: Page): Promise<readonly ApplicationField[]> {
    return page.locator("input, textarea, select").evaluateAll((elements) =>
      elements.map((element) => {
        const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const id = input.id;
        const label = id
          ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() ?? null
          : input.closest("label")?.textContent?.trim() ?? null;

        let type: ApplicationFieldType = "unknown";
        if (input instanceof HTMLTextAreaElement) type = "textarea";
        else if (input instanceof HTMLSelectElement) type = "select";
        else if (input instanceof HTMLInputElement) {
          const inputType = input.type.toLowerCase();
          if (["text", "email", "tel", "url"].includes(inputType)) type = inputType as ApplicationFieldType;
          else if (["checkbox", "radio", "file"].includes(inputType)) type = inputType as ApplicationFieldType;
        }

        return {
          name: input.getAttribute("name") ?? id ?? "",
          type,
          required: input.required,
          label,
          placeholder: input.getAttribute("placeholder")
        };
      })
    );
  }
}
