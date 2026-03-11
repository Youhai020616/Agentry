#!/bin/bash

# Post-removal script for Agentry on Linux

set -e

# Remove symbolic link
rm -f /usr/local/bin/agentry 2>/dev/null || true

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database -q /usr/share/applications || true
fi

# Update icon cache
if command -v gtk-update-icon-cache &> /dev/null; then
    gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi

echo "Agentry has been removed."
