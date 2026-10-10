# Accessibility

Onyx should be usable by everyone, including people who use a keyboard instead of a mouse, a screen reader, high zoom or high contrast.

## What Onyx supports

- **Keyboard:** every main action has a shortcut, and the file list, folder tree, menus and dialogs can be used with the keyboard alone. Shortcuts can be changed in Settings → Hotkeys.
- **Focus:** focused items show a visible ring when you navigate with the keyboard.
- **Screen readers:** lists, trees, menus, tabs and dialogs use the matching accessibility roles, and icon-only buttons have text labels.
- **Text size and density:** the font size, font and density can be changed in Settings → Appearance, and Electron's zoom (<kbd>Ctrl</kbd> <kbd>+</kbd> / <kbd>Ctrl</kbd> <kbd>-</kbd>) works everywhere.
- **Color:** dark and light themes, plus a builder for your own color scheme. Text in the built-in themes aims for WCAG AA contrast.
- **Motion:** Settings → Appearance → Reduce motion turns animations off, or follows Windows' setting.
- **Safety:** nothing moves until you approve it, destructive dialogs start on Cancel, and organizing can be undone.

## Known limitations

- The graph view is visual only; the same information is available as a folder tree and a list of every move on the Organize screen.
- Onyx is tested on Windows 10 and 11 at 100% to 200% scaling. Other setups may have rough edges.

## Report a barrier

If something in Onyx is hard or impossible for you to use, [open an issue](../../issues/new?template=bug_report.yml) and add "Accessibility" to the title. Describe what you were trying to do and what assistive technology you use, if any.
