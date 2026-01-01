/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import App from './App';
import './index.css';

const root = document.getElementById('root');

render(
  () => (
    <Router>
      <Route path="/" component={App} />
      <Route path="/chat/:id" component={App} />
    </Router>
  ),
  root
);
