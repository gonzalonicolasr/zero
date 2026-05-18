# Requisitos — Sincronización de métricas de run vía Cortex

## Resumen
El autotune de zero aprende qué modelo de Claude conviene a cada fase del pipeline SDD a partir de un log de resultados local: `~/.pi/zero-runs.jsonl`, un archivo append-only de `RunRecord`s que la extensión `autotune-extension.ts` lee de forma determinista, síncrona y **offline** en cada `session_start` de pi. Hoy ese log vive en una sola máquina, así que cada equipo donde Gonzalo corre zero aprende por separado. Esta feature usa Cortex (el servidor MCP de memoria persistente que zero instala) como capa de sincronización: el orquestrador SDD **empuja** cada `RunRecord` a Cortex al terminar un run y **trae** los `RunRecord`s originados en otras máquinas al iniciar un run, fusionándolos en el `.jsonl` local. El `.jsonl` pasa a ser una caché local de un log compartido; la extensión de autotune no se modifica y sigue siendo hermética y offline.

## Fuera de alcance
- Modificar la lógica de decisión/agregación del autotune (`decideAdjustments`, `aggregate`, la matemática de tiers, las compuertas `MIN_SAMPLES`). La feature solo cambia *de dónde vienen* las muestras, no cómo se procesan.
- Cambiar el trazo en prosa `zero-run/<slug>` (`memoria_save` tipo `session_summary`) que el orquestrador ya guarda en Cortex en la sección "## Run memory". Ese trazo legible-por-humanos queda tal cual; no es el log estructurado de métricas.
- Hacer que `autotune-extension.ts` —o cualquier extensión/comando de pi— llame a la red o a herramientas MCP. El código de pi sigue sin tocar la red.
- Definir el esquema de almacenamiento en Cortex (nombre de `topic_key`, tipo de memoria, namespace de proyecto). Eso es una decisión de **diseño**, no un requisito.
- Soporte para Claude Code — esta feature es la capa pi (`@gonrocca/zero-pi`) y el prompt del orquestrador únicamente.

## Historias de usuario y criterios de aceptación

### 1. Push del RunRecord a Cortex al terminar el run
**Como** usuario de zero que corre el pipeline en varias máquinas, **quiero** que cada run terminado se guarde también en Cortex, **para que** su resultado quede disponible para el autotune de las demás máquinas.

Criterios de aceptación (EARS):
- CUANDO un run alcanza un veredicto (`pasa`) o agota el tope de iteraciones (`cap-reached`), EL SISTEMA DEBERÁ, después de escribir la línea local en `~/.pi/zero-runs.jsonl`, guardar ese mismo `RunRecord` en Cortex vía una herramienta MCP de Cortex.
- EL SISTEMA DEBERÁ guardar en Cortex exactamente el mismo `RunRecord` que escribió localmente —mismos campos `v`, `ts`, `feature`, `phases`, `verdict`, `rounds`, `verdicts`— sin alterar ni reformatear los datos.
- CUANDO el run fue abortado antes de que la fase `veredicto` produjera un veredicto, EL SISTEMA DEBERÁ no escribir ni la línea local ni el registro en Cortex (consistente con la regla "sin veredicto no hay registro").
- EL SISTEMA DEBERÁ realizar el push como un paso adicional y separado del trazo en prosa `zero-run/<slug>` (`session_summary`); ambos coexisten y ninguno reemplaza al otro.
- CUANDO el push a Cortex se completa, EL SISTEMA DEBERÁ no modificar ni reescribir la línea ya añadida al `.jsonl` local.

### 2. Pull de RunRecords de otras máquinas al iniciar el run
**Como** usuario de zero, **quiero** que al empezar un run se traigan de Cortex los `RunRecord`s generados en otras máquinas, **para que** el autotune local aprenda del historial compartido.

Criterios de aceptación (EARS):
- CUANDO arranca un run `/forge` (al inicio del pipeline, antes de la fase explore), EL SISTEMA DEBERÁ consultar Cortex por los `RunRecord`s del log compartido y fusionar en `~/.pi/zero-runs.jsonl` los que aún no estén presentes localmente.
- EL SISTEMA DEBERÁ fusionar los registros traídos respetando la naturaleza append-only del `.jsonl`: añadir líneas nuevas, sin reescribir, reordenar ni borrar las existentes, y creando el archivo si no existe.
- EL SISTEMA DEBERÁ escribir cada `RunRecord` traído de Cortex en el `.jsonl` con la misma forma de una línea (un objeto JSON serializado sin formateo, seguido de un único salto de línea) que produce el push local.
- DADO que el orquestrador corre por `/forge` y no en `session_start`, EL SISTEMA DEBERÁ aceptar que un registro recién traído recién influye en el autotune de la **sesión siguiente** —un retraso de una sesión, coherente con el retraso de un run que el autotune ya documenta.
- CUANDO el pull no encuentra registros nuevos en Cortex, EL SISTEMA DEBERÁ dejar el `.jsonl` local sin cambios y continuar el run normalmente.

### 3. Garantía de no duplicación entre máquinas
**Como** mantenedor de zero, **quiero** que un mismo `RunRecord` nunca cuente dos veces, **para que** la agregación del autotune no sesgue por registros repetidos.

Criterios de aceptación (EARS):
- EL SISTEMA DEBERÁ tratar el par `(feature, ts)` de un `RunRecord` como su identidad — dos runs del mismo slug en el mismo milisegundo se consideran imposibles en la práctica.
- CUANDO el autotune procesa el `.jsonl` local, EL SISTEMA DEBERÁ contar como una sola muestra a cada `(feature, ts)` aunque la línea aparezca más de una vez en el archivo (un pull descuidado que reañada un registro ya presente no debe inflar el conteo).
- EL SISTEMA DEBERÁ aplicar la de-duplicación de forma determinista: dada la misma colección de líneas, el resultado de muestras únicas es siempre el mismo, independientemente del orden de las líneas.
- CUANDO un `RunRecord` empujado a Cortex por esta máquina vuelve a esta misma máquina en un pull posterior, EL SISTEMA DEBERÁ no producir una muestra duplicada para el autotune.

### 4. Una falla de Cortex nunca bloquea ni falla un run
**Como** usuario de zero, **quiero** que cualquier problema con Cortex no afecte el resultado del run, **para que** el pipeline funcione igual offline o sin MCP.

Criterios de aceptación (EARS):
- SI el push a Cortex falla por cualquier motivo (servidor caído, error MCP, timeout), ENTONCES EL SISTEMA DEBERÁ emitir una advertencia no bloqueante y continuar — el resultado del run se mantiene y la línea local del `.jsonl` ya quedó escrita.
- SI el pull desde Cortex falla por cualquier motivo, ENTONCES EL SISTEMA DEBERÁ emitir una advertencia no bloqueante y continuar el run, dejando que el autotune use lo que haya local.
- CUANDO zero fue instalado con `--no-mcp` (Cortex no disponible), EL SISTEMA DEBERÁ omitir push y pull silenciosamente y dejar que el run y el autotune procedan solo con el `.jsonl` local.
- EL SISTEMA DEBERÁ garantizar que ni el push ni el pull puedan abortar, fallar o demorar indefinidamente un run — esto refleja la regla existente "el loop de memoria nunca debe bloquear un run".
- CUANDO un pull o push falla, EL SISTEMA DEBERÁ no dejar el `.jsonl` local en un estado corrupto o parcialmente escrito que impida al autotune leerlo.

### 5. El autotune permanece offline y sin modificar
**Como** mantenedor de zero, **quiero** que la extensión de autotune siga siendo hermética, **para que** la propiedad offline/determinista del autotune se preserve como invariante de diseño.

Criterios de aceptación (EARS):
- EL SISTEMA DEBERÁ no modificar `autotune-extension.ts` ni `autotune.ts` para hablar con la red, con MCP ni con Cortex — su única fuente de entrada sigue siendo el archivo local `~/.pi/zero-runs.jsonl`.
- CUANDO la extensión de autotune corre en `session_start`, EL SISTEMA DEBERÁ mantenerla determinista, síncrona, sin dependencias (solo `node:fs`/`node:os`/`node:path`) y capaz de funcionar completamente offline.
- EL SISTEMA DEBERÁ ubicar las nuevas responsabilidades de push y pull exclusivamente en el orquestrador SDD (un LLM con acceso MCP), nunca en código de extensión o comando de pi — el código de pi no puede invocar herramientas MCP.
- EL SISTEMA DEBERÁ mantener `~/.pi/zero-runs.jsonl` como única fuente que la extensión de autotune lee; el archivo pasa a ser una caché local de un log respaldado en Cortex, pero su rol frente al autotune no cambia.

### 6. Agregación cross-máquina sin cambios en la lógica de decisión
**Como** usuario de zero, **quiero** que el historial compartido alimente al autotune existente tal cual, **para que** las compuertas de muestras mínimas se satisfagan más rápido sin reescribir la lógica.

Criterios de aceptación (EARS):
- CUANDO el `.jsonl` local contiene `RunRecord`s de varias máquinas tras uno o más pulls, EL SISTEMA DEBERÁ permitir que la agregación existente del autotune los procese sin ningún cambio en `aggregate` ni en `decideAdjustments`.
- EL SISTEMA DEBERÁ tratar un `RunRecord` traído de otra máquina como una muestra equivalente a una local — el origen de la máquina no altera cómo cuenta para la agregación.
- CUANDO el historial combinado de varias máquinas alcanza el umbral `MIN_SAMPLES` para un par `(fase, modelo)`, EL SISTEMA DEBERÁ permitir que el autotune emita un ajuste igual que lo haría con muestras puramente locales — más muestras solo aceleran cruzar la compuerta.
- EL SISTEMA DEBERÁ preservar el comportamiento del autotune frente a registros `v:1` y `v:2` ya existente; los registros sincronizados desde Cortex se leen con las mismas reglas que los locales.

## Preguntas abiertas
- Ninguna. El enfoque (Cortex como capa de sync; `.jsonl` como caché; push al final y pull al inicio; identidad `(feature, ts)`; de-duplicación en el lector; nunca bloquear el run) está fijado por el pedido. El esquema concreto de almacenamiento en Cortex y el mecanismo exacto de de-duplicación se resuelven en la fase de diseño.
