# Procure Consolidator

## Description
Procure Consolidator est une application d'analyse Achats/Décaissements qui permet d'ingérer des fichiers Excel, de les normaliser et de les charger dans DuckDB en mémoire. L'application expose un chat analytique où un LLM local via Ollama génère des requêtes SQL exécutées contre DuckDB.

## Stack Technique

### Frontend
- **Framework**: React avec TypeScript
- **Build Tool**: Vite
- **Librairies principales**: 
  - lucide-react (icônes)
  - recharts (graphiques)

### Backend
- **Runtime**: Node.js (ESM)
- **Framework**: Express
- **Base de données**: DuckDB (en mémoire)
- **Traitement des fichiers**: xlsx, multer
- **LLM**: Ollama exposé en API OpenAI-compatible

## Fonctionnalités
- Upload de fichiers Excel (.xlsx) d'achats, commandes et décaissements
- Normalisation et chargement des données dans DuckDB
- Chat analytique avec génération de requêtes SQL via LLM
- Visualisation des données sous forme de tableaux et graphiques
- Analyse des tendances de décaissements

## Installation

### Prérequis
- Node.js (v16+)
- Ollama installé localement

### Installation du backend
```bash
cd server
npm install
```

### Installation du frontend
```bash
cd client
npm install
```
