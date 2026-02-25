"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requirePlugin = requirePlugin;
const fs_extra_1 = require("fs-extra");
const posix_1 = require("path/posix");
const watch_1 = require("./watch");
async function requirePlugin(editor, options) {
    const isLocalPlugin = await (0, fs_extra_1.pathExists)(options.pluginNameOrPath);
    let requireId = options.pluginNameOrPath;
    if (!isLocalPlugin) {
        const projectDir = (0, posix_1.dirname)(options.projectPath);
        requireId = (0, posix_1.join)(projectDir, "node_modules", options.pluginNameOrPath);
    }
    const result = require(requireId);
    result.main(editor);
    if (isLocalPlugin) {
        editor.layout.console.log(`Loaded plugin from local drive "${result.title ?? options.pluginNameOrPath}"`);
    }
    else {
        editor.layout.console.log(`Loaded plugin "${result.title ?? options.pluginNameOrPath}"`);
    }
    if (isLocalPlugin && !options.noWatch) {
        try {
            (0, watch_1.watchPlugin)(editor, requireId, options);
        }
        catch (e) {
            editor.layout.console.error("An error occured, failed to watch plugin for changes.");
            if (e instanceof Error) {
                editor.layout.console.error(e.message);
            }
        }
    }
}
//# sourceMappingURL=require.js.map