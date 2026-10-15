#!/usr/bin/env bash
exec journalctl -u ceia-agent -f --no-pager
