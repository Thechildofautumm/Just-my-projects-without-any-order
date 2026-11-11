// В релизной сборке под Windows не показывать консольное окно.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    av_scenariy_lib::run()
}
