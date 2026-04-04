# 🚀 INSTRUCCIONES DE IMPLEMENTACIÓN PARA REPLIT

## Sistema de Excel con Procesamiento en Segundo Plano

Este sistema permite generar documentos Excel complejos que **continúan procesándose 
aunque el usuario cambie de pestaña o minimice el navegador**.

---

## 📦 PASO 1: Crear el proyecto en Replit

1. Crear un nuevo Repl con template **React (Vite)**
2. O usar un proyecto React existente

---

## 📦 PASO 2: Instalar dependencias

En la Shell de Replit, ejecutar:

```bash
npm install recharts xlsx
```

---

## 📦 PASO 3: Copiar el código

1. Crear un archivo llamado `ExcelBackgroundSystem.jsx` en la carpeta `src/`
2. Copiar TODO el contenido del archivo `excel-background-system.jsx`
3. Pegarlo en el nuevo archivo

---

## 📦 PASO 4: Modificar App.jsx

Reemplazar el contenido de `src/App.jsx` con:

```jsx
import ExcelWithBackgroundProcessing from './ExcelBackgroundSystem';

function App() {
  return <ExcelWithBackgroundProcessing />;
}

export default App;
```

---

## 📦 PASO 5: Modificar index.css (opcional)

Para asegurar que ocupe toda la pantalla, agregar a `src/index.css`:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  width: 100%;
}
```

---

## 🎯 CÓMO USAR

1. **Hacer clic en "✨ Generar Workbook de Ventas"**
   - Se generarán 4 hojas con datos, fórmulas y gráficos
   - El proceso muestra progreso en tiempo real

2. **Cambiar de pestaña o minimizar el navegador**
   - El indicador cambiará a "Procesando en segundo plano"
   - El proceso **NO se detiene** gracias al Web Worker

3. **Volver a la pestaña**
   - Todas las actualizaciones pendientes se aplican automáticamente
   - El progreso se actualiza

4. **Cerrar y volver a abrir la página**
   - Si hay tareas pendientes, se recuperan automáticamente de IndexedDB

---

## 🏗️ ARQUITECTURA

```
┌─────────────────────────────────────────────────────────────┐
│                     MAIN THREAD                              │
│  React UI ◄─── Callbacks ◄─── Page Visibility API           │
└────────────────────────┬────────────────────────────────────┘
                         │ postMessage
┌────────────────────────▼────────────────────────────────────┐
│                      WEB WORKER                              │
│  • NO afectado por throttling de tabs inactivos             │
│  • Usa MessageChannel (no setTimeout)                        │
│  • Procesa en batches de 50 tareas                          │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                      IndexedDB                               │
│  • Persistencia de tareas pendientes                        │
│  • Recuperación automática al recargar                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 CARACTERÍSTICAS

| Característica | Descripción |
|----------------|-------------|
| Grid Masivo | 10,000 × 10,000 celdas con virtualización |
| Background Processing | Web Worker inmune al throttling |
| Persistencia | IndexedDB para recuperación automática |
| Multi-tab | Coordinación con BroadcastChannel |
| Fórmulas | SUM, AVERAGE, COUNT, MAX, MIN, IF, ROUND |
| Gráficos | Barras, líneas, circular, área (Recharts) |
| Notificaciones | Alerta cuando completa en background |

---

## 🔧 PERSONALIZACIÓN

### Generar datos personalizados

Puedes crear tu propia función de generación de tareas:

```jsx
const generateCustomTasks = () => {
  const tasks = [];
  
  // Insertar celda
  tasks.push({ 
    action: 'INSERT_CELL', 
    row: 0, 
    col: 0, 
    value: 'Mi valor' 
  });
  
  // Evaluar fórmula
  tasks.push({ 
    action: 'EVALUATE_FORMULA', 
    row: 1, 
    col: 0, 
    formula: '=SUM(A1:A10)' 
  });
  
  // Crear gráfico
  tasks.push({
    action: 'GENERATE_CHART',
    chartType: 'bar', // 'bar', 'line', 'pie', 'area'
    title: 'Mi Gráfico',
    dataRange: 'A1:B10',
    position: { row: 0, col: 5 },
    size: { width: 400, height: 300 }
  });
  
  return tasks;
};
```

### Tipos de tareas soportadas

| Acción | Parámetros |
|--------|------------|
| `INSERT_CELL` | `row, col, value, format` |
| `EVALUATE_FORMULA` | `row, col, formula` |
| `BULK_INSERT` | `cells: [{row, col, value}]` |
| `CREATE_SHEET` | `name, sheetId` |
| `GENERATE_CHART` | `chartType, title, dataRange, position, size` |
| `APPLY_FORMAT` | `range, format` |
| `APPLY_CONDITIONAL_FORMAT` | `range, rules` |

### Fórmulas soportadas

```
=SUM(A1:A100)              // Suma
=AVERAGE(B2:B50)           // Promedio
=COUNT(C1:C100)            // Contar
=MAX(D1:D100)              // Máximo
=MIN(E1:E100)              // Mínimo
=IF(A1>100,"Alto","Bajo")  // Condicional
=ROUND(A1/B1*100, 2)       // Redondear
=A1*B1+C1                  // Operaciones matemáticas
```

---

## ⚠️ NOTAS IMPORTANTES

1. **El Web Worker usa `MessageChannel`** en lugar de `setTimeout` para evitar 
   el throttling del navegador en pestañas inactivas.

2. **IndexedDB** guarda las tareas pendientes, permitiendo recuperar el proceso 
   si el usuario cierra y vuelve a abrir la página.

3. **BroadcastChannel** coordina entre múltiples pestañas para evitar 
   procesamiento duplicado (leader election).

4. **Page Visibility API** detecta cuando la pestaña está oculta y acumula 
   actualizaciones en un buffer, aplicándolas en batch cuando el usuario regresa.

---

## 🎉 ¡LISTO!

El sistema está configurado para:
- ✅ Procesar en segundo plano sin interrupciones
- ✅ Recuperar tareas si se cierra la página
- ✅ Coordinar entre múltiples pestañas
- ✅ Notificar cuando completa (si está en background)
- ✅ Mostrar progreso en tiempo real con estadísticas

---

## 📞 SOPORTE

Si tienes problemas:
1. Verifica que las dependencias estén instaladas (`recharts`, `xlsx`)
2. Revisa la consola del navegador para errores
3. Asegúrate de que el navegador soporte Web Workers e IndexedDB
