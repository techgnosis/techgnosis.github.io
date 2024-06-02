#! /usr/bin/env bash

set -euo pipefail


rm -rf ../techgnosis.github.io/blog/
hugo
cp -r public ../techgnosis.github.io/blog