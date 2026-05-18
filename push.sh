#!/bin/bash

# Run git add .
echo "Running: git add ."
git add .
echo ""

# Prompt for commit message
read -p "Enter commit message: " commit_msg
echo ""

# Run git commit with -C appended to message
echo "Running: git commit -m \"$commit_msg\""
git commit -m "$commit_msg"
echo ""

# Run git push
echo "Running: git push"
git push
