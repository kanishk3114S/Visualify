import { forwardRef } from "react";
import { SelectField } from "../../components/Field.jsx";
import { buildFolderTree } from "../../lib/libraryFilters.js";

/** Folder picker rendered as an indented tree. Value "" = no folder (library root). */
export const FolderSelect = forwardRef(function FolderSelect({ folders = [], exclude = new Set(), rootLabel = "No folder", ...props }, ref) {
  const tree = buildFolderTree(folders);
  return (
    <SelectField ref={ref} {...props}>
      <option value="">{rootLabel}</option>
      {tree
        .filter((f) => !exclude.has(f.id))
        .map((f) => (
          <option key={f.id} value={f.id}>
            {`${"  ".repeat(f.depth)}${f.depth ? "└ " : ""}${f.name}`}
          </option>
        ))}
    </SelectField>
  );
});
