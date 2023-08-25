importScripts("https://cdn.jsdelivr.net/pyodide/v0.22.1/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/0.14.4/dist/wheels/bokeh-2.4.3-py3-none-any.whl', 'https://cdn.holoviz.org/panel/0.14.4/dist/wheels/panel-0.14.4-py3-none-any.whl', 'pyodide-http==0.1.0', 'folium', 'awesome_panel', 'awesome-panel-extensions']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()

"""
The purpose of this app is to demonstrate that Panel works with the tools you know and love
&#10084;&#65039;, including Folium.
"""
from html import escape  # noqa

import folium
import panel as pn

from awesome_panel import config

config.extension(url="lib_folium")

# pylint: disable=protected-access


def get_plot():
    """Returns a Folium plot"""
    plot = folium.Map(
        location=[45.372, -121.6972], zoom_start=12, tiles="Stamen Terrain"
    )  # ,  width='100%', height="50%")

    folium.Marker(
        location=[45.3311, -121.7113],
        popup="Timberline Lodge",
        icon=folium.Icon(color="green"),
    ).add_to(plot)

    folium.Marker(
        location=[45.3300, -121.6823],
        popup="Some Other Location",
        icon=folium.Icon(color="red", icon="info-sign"),
    ).add_to(plot)
    return plot


PLOT = get_plot()


def _get_properties(self):
    properties = pn.pane.HTML._get_properties(self)
    text = "" if self.object is None else self.object
    if hasattr(text, "_repr_html_"):
        text = text._repr_html_()
        # pylint: disable=line-too-long
        before = '<div style="width:100%;"><div style="position:relative;width:100%;height:0;padding-bottom:60%;">'
        after = '<div style="width:100%;height:100%"><div style="position:relative;width:100%;height:100%;padding-bottom:0%;">'
        text = text.replace(before, after)
    return dict(properties, text=escape(text))


# A Hack to be able to get responsive Folium plots
pn.pane.plot.Folium._get_properties = _get_properties

pn.pane.plot.Folium(PLOT, min_height=700, sizing_mode="stretch_both").servable()


await write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.runPythonAsync(`
    import json

    state.curdoc.apply_json_patch(json.loads('${msg.patch}'), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads("""${msg.location}""")
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()