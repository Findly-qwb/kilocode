import { render } from "solid-js/web"
import { connect } from "./client"
import { App } from "./App"
import { store } from "./store"
import "./index.css"

void connect().then(() => store.refresh())

render(() => <App />, document.getElementById("root")!)
