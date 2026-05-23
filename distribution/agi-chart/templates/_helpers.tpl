{{/*
SPDX-License-Identifier: Apache-2.0
Common template helpers.
*/}}

{{/* Truncated release name (RFC 1123, max 63 chars). */}}
{{- define "agi.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully-qualified app name: <release>-<chart>. */}}
{{- define "agi.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* Component-scoped names. */}}
{{- define "agi.runtime.fullname" -}}
{{- printf "%s-runtime" (include "agi.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "agi.ui.fullname" -}}
{{- printf "%s-ui" (include "agi.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "agi.packs.configmapName" -}}
{{- if .Values.runtime.packs.configMapName -}}
{{- .Values.runtime.packs.configMapName -}}
{{- else -}}
{{- printf "%s-packs" (include "agi.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/* Common labels. */}}
{{- define "agi.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "agi.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: project-agi
{{- end -}}

{{/* Component selector labels. */}}
{{- define "agi.runtime.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agi.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: runtime
{{- end -}}

{{- define "agi.ui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agi.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: ui
{{- end -}}

{{/* Image reference with appVersion fallback. */}}
{{- define "agi.image" -}}
{{- $repo := .repo -}}
{{- $tag := .tag | default .root.Chart.AppVersion -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}

{{/* Service account name resolution. */}}
{{- define "agi.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "agi.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
