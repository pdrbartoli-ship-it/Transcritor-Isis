# Põe a extensão de compartilhar (App/Compartilhar) no projeto do Xcode.
#
# Existe porque não temos Mac: o normal seria criar a extensão pelo Xcode, que
# escreve tudo no project.pbxproj. Aqui quem escreve é a biblioteca xcodeproj
# (a mesma do CocoaPods), que roda em qualquer lugar com Ruby:
#
#   gem install xcodeproj
#   ruby frontend/ios/adicionar-extensao.rb
#
# O resultado já está no git; rodar de novo não muda nada. Só serve se o
# projeto do iPhone for recriado do zero (um `cap add ios`, por exemplo).
require 'xcodeproj'

projeto = Xcodeproj::Project.open(File.join(__dir__, 'App', 'App.xcodeproj'))
if projeto.targets.any? { |t| t.name == 'Compartilhar' }
  puts 'A extensão já está no projeto.'
  exit
end

app = projeto.targets.find { |t| t.name == 'App' }
extensao = projeto.new_target(:app_extension, 'Compartilhar', :ios, '15.0', projeto.products_group, :swift)

# O new_target liga o Foundation pelo caminho do SDK desta máquina
# (iPhoneOS26.0.sdk, por exemplo), que não existe num Xcode de outra versão.
# O Swift já liga o Foundation e o UIKit sozinho, pelo `import`.
extensao.frameworks_build_phase.files.to_a.each do |arquivo|
  referencia = arquivo.file_ref
  arquivo.remove_from_project
  referencia&.remove_from_project
end
projeto.frameworks_group.recursive_children.select { |g| g.is_a?(Xcodeproj::Project::Object::PBXGroup) && g.children.empty? }.each(&:remove_from_project)
projeto.frameworks_group.remove_from_project if projeto.frameworks_group.children.empty?

grupo = projeto.main_group.new_group('Compartilhar', 'Compartilhar')
fonte = grupo.new_reference('ShareViewController.swift')
grupo.new_reference('Info.plist')
grupo.new_reference('Compartilhar.entitlements')
extensao.add_file_references([fonte])

extensao.build_configurations.each do |config|
  b = config.build_settings
  b['PRODUCT_BUNDLE_IDENTIFIER'] = 'br.com.albiecloud.dito.compartilhar'
  b['PRODUCT_NAME'] = '$(TARGET_NAME)'
  b['INFOPLIST_FILE'] = 'Compartilhar/Info.plist'
  b['GENERATE_INFOPLIST_FILE'] = 'NO'
  b['CODE_SIGN_ENTITLEMENTS'] = 'Compartilhar/Compartilhar.entitlements'
  b['CODE_SIGN_STYLE'] = 'Automatic'
  # Versão e número da build iguais aos do app: a Apple recusa extensão com
  # número diferente do app que a carrega. O `agvtool new-version -all` do
  # Codemagic numera as duas juntas.
  b['MARKETING_VERSION'] = '1.0'
  b['CURRENT_PROJECT_VERSION'] = '1'
  b['SWIFT_VERSION'] = '5.0'
  b['TARGETED_DEVICE_FAMILY'] = '1,2'
  b['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
  b['SKIP_INSTALL'] = 'YES'
  b['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  b['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

# O app monta a extensão antes de si e a leva dentro dele, em PlugIns/.
app.add_dependency(extensao)
embutir = app.new_copy_files_build_phase('Embed Foundation Extensions')
embutir.symbol_dst_subfolder_spec = :plug_ins
arquivo = embutir.add_file_reference(extensao.product_reference, true)
arquivo.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

projeto.save
puts 'Extensão adicionada.'
