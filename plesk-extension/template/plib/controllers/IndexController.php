<?php

class IndexController extends pm_Controller_Action
{
    protected $_accessLevel = 'admin';

    public function init()
    {
        parent::init();
        $this->view->pageTitle = 'Example Product Manager';
        $this->view->headLink()->appendStylesheet(pm_Context::getBaseUrl() . 'css/kitsune-platform.css?v=1');
        $this->view->headScript()->appendFile(pm_Context::getBaseUrl() . 'js/kitsune-platform.js?v=1');
        $this->view->suiteProduct = 'Example Product Manager';
        $this->view->suiteVersion = '0.1.0';
        try { $this->view->suiteHubActive = pm_Extension::getById('kitsuneserv-bridge')->isActive(); }
        catch (Throwable $exception) { $this->view->suiteHubActive = false; }
    }

    public function indexAction()
    {
        $this->view->state = ['status' => 'ready'];
    }
}
