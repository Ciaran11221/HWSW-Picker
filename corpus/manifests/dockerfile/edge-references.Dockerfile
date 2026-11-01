ARG NODE_VERSION=21
FROM --platform=linux/amd64 docker.io/library/Ubuntu:22.04 AS base
FROM ghcr.io/example-org/Builder-Image:v3.1.4-slim AS builder
FROM localhost:5000/team/tool@sha256:0123456789abcdef AS tool
FROM Base AS derived
FROM builder
FROM golang:1.22.3-bookworm AS gobuild
FROM python:latest
FROM node:${NODE_VERSION}-bullseye AS final
FROM $BASE_IMAGE
FROM scratch
FROM bitnami/postgresql:16
FROM postgres:16 \
  AS multiline
RUN echo "FROM not-an-image:1"
