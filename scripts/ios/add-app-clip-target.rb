#!/usr/bin/env ruby

require "xcodeproj"

project_path = File.expand_path("../../PorizoApp/PorizoApp.xcodeproj", __dir__)
project = Xcodeproj::Project.open(project_path)
target_name = "PorizoAppClip"

def ensure_shared_scheme(project_path, target)
  scheme_path = File.join(project_path, "xcshareddata", "xcschemes", "#{target.name}.xcscheme")
  return if File.exist?(scheme_path)

  scheme = Xcodeproj::XCScheme.new
  scheme.configure_with_targets(target, nil, launch_target: true)
  scheme.launch_action.environment_variables = Xcodeproj::XCScheme::EnvironmentVariables.new([
    { key: "_XCAppClipURL", value: "https://porizo.co/play/REPLACE_WITH_SHARE_ID", enabled: true }
  ])
  scheme.save_as(project_path, target.name, true)
end

def ensure_embedded_product(app, product, phase_name, destination, path = "")
  phase = app.copy_files_build_phases.find { |candidate| candidate.name == phase_name }
  phase ||= app.new_copy_files_build_phase(phase_name)
  phase.dst_subfolder_spec = destination
  phase.dst_path = path

  build_file = phase.files.find { |file| file.file_ref == product }
  build_file ||= phase.add_file_reference(product, true)
  build_file.settings = { "ATTRIBUTES" => %w[RemoveHeadersOnCopy CodeSignOnCopy] }
end

def place_embed_phases_before_scripts(app)
  insertion_index = app.build_phases.index(app.resources_build_phase) + 1
  ["Embed App Clips", "Embed App Extensions"].each do |phase_name|
    phase = app.copy_files_build_phases.find { |candidate| candidate.name == phase_name }
    next unless phase

    app.build_phases.move(phase, insertion_index)
    insertion_index += 1
  end
end

if (existing_target = project.targets.find { |target| target.name == target_name })
  app = project.targets.find { |target| target.name == "PorizoApp" }
  raise "PorizoApp target not found" unless app
  app.build_configurations.each do |config|
    config.build_settings["CODE_SIGN_STYLE"] = "Manual"
    config.build_settings["CODE_SIGN_IDENTITY"] = "Apple Development"
    config.build_settings["PROVISIONING_PROFILE_SPECIFIER"] = "Porizo Development App Clip 20260711"
  end

  existing_target.build_configurations.each do |config|
    config.build_settings["ASSETCATALOG_COMPILER_APPICON_NAME"] = "AppIcon"
    config.build_settings["CODE_SIGN_STYLE"] = "Manual"
    config.build_settings["CODE_SIGN_IDENTITY"] = "Apple Development"
    config.build_settings["CURRENT_PROJECT_VERSION"] = "148"
    config.build_settings["PROVISIONING_PROFILE_SPECIFIER"] = "Porizo App Clip Development"
  end

  clip_group = project.main_group.find_subpath("PorizoAppClip", true)
  assets = clip_group.files.find { |file| file.path == "Assets.xcassets" } || clip_group.new_file("Assets.xcassets")
  unless existing_target.resources_build_phase.files.any? { |file| file.file_ref == assets }
    existing_target.resources_build_phase.add_file_reference(assets, true)
  end

  ensure_embedded_product(
    app,
    existing_target.product_reference,
    "Embed App Clips",
    Xcodeproj::Constants::COPY_FILES_BUILD_PHASE_DESTINATIONS[:products_directory],
    "$(CONTENTS_FOLDER_PATH)/AppClips"
  )

  notification_extension = project.targets.find { |target| target.name == "PorizoNotificationServiceExtension" }
  if notification_extension
    ensure_embedded_product(
      app,
      notification_extension.product_reference,
      "Embed App Extensions",
      Xcodeproj::Constants::COPY_FILES_BUILD_PHASE_DESTINATIONS[:plug_ins]
    )
  end

  place_embed_phases_before_scripts(app)
  project.save
  ensure_shared_scheme(project_path, existing_target)
  puts "#{target_name} already exists; embedding and shared scheme verified"
  exit 0
end

clip_group = project.main_group.find_subpath("PorizoAppClip", true)
clip_group.set_source_tree("<group>")
clip_group.path = "PorizoAppClip"
source_paths = %w[PorizoAppClipApp.swift AppClipReceiverModel.swift]
source_refs = source_paths.map do |name|
  clip_group.files.find { |file| file.path == name } || clip_group.new_file(name)
end
clip_group.new_file("Info.plist") unless clip_group.files.any? { |file| file.path == "Info.plist" }
clip_group.new_file("PorizoAppClip.entitlements") unless clip_group.files.any? { |file| file.path == "PorizoAppClip.entitlements" }
assets = clip_group.files.find { |file| file.path == "Assets.xcassets" } || clip_group.new_file("Assets.xcassets")

clip = project.new_target(
  :application_on_demand_install_capable,
  target_name,
  :ios,
  "17.0"
)
clip.add_file_references(source_refs)
clip.resources_build_phase.add_file_reference(assets, true)

clip.build_configurations.each do |config|
  settings = config.build_settings
  settings["ASSETCATALOG_COMPILER_APPICON_NAME"] = "AppIcon"
  settings["APPLICATION_EXTENSION_API_ONLY"] = "YES"
  settings["CODE_SIGN_ENTITLEMENTS"] = "PorizoAppClip/PorizoAppClip.entitlements"
  settings["CODE_SIGN_STYLE"] = "Manual"
  settings["CURRENT_PROJECT_VERSION"] = "148"
  settings["DEVELOPMENT_TEAM"] = "5VCH6937XM"
  settings["GENERATE_INFOPLIST_FILE"] = "NO"
  settings["INFOPLIST_FILE"] = "PorizoAppClip/Info.plist"
  settings["MARKETING_VERSION"] = "1.5.27"
  settings["PRODUCT_BUNDLE_IDENTIFIER"] = "porizo.ios.app.PorizoApp.Clip"
  settings["PRODUCT_NAME"] = "$(TARGET_NAME)"
  # The archive must use the same signing family as its containing app.
  # App Store distribution profiles are selected later by exportOptionsPlist.
  settings["CODE_SIGN_IDENTITY"] = "Apple Development"
  settings["PROVISIONING_PROFILE_SPECIFIER"] = "Porizo App Clip Development"
  settings["SKIP_INSTALL"] = "YES"
  settings["SWIFT_VERSION"] = "5.0"
  settings["TARGETED_DEVICE_FAMILY"] = "1,2"
end

app = project.targets.find { |target| target.name == "PorizoApp" }
raise "PorizoApp target not found" unless app
app.build_configurations.each do |config|
  config.build_settings["CODE_SIGN_STYLE"] = "Manual"
  config.build_settings["CODE_SIGN_IDENTITY"] = "Apple Development"
  config.build_settings["PROVISIONING_PROFILE_SPECIFIER"] = "Porizo Development App Clip 20260711"
end

app.add_dependency(clip)
ensure_embedded_product(
  app,
  clip.product_reference,
  "Embed App Clips",
  Xcodeproj::Constants::COPY_FILES_BUILD_PHASE_DESTINATIONS[:products_directory],
  "$(CONTENTS_FOLDER_PATH)/AppClips"
)

notification_extension = project.targets.find { |target| target.name == "PorizoNotificationServiceExtension" }
if notification_extension
  ensure_embedded_product(
    app,
    notification_extension.product_reference,
    "Embed App Extensions",
    Xcodeproj::Constants::COPY_FILES_BUILD_PHASE_DESTINATIONS[:plug_ins]
  )
end
place_embed_phases_before_scripts(app)

attributes = project.root_object.attributes["TargetAttributes"] ||= {}
attributes[clip.uuid] = {
  "CreatedOnToolsVersion" => "26.0",
  "ProvisioningStyle" => "Automatic"
}

project.save
ensure_shared_scheme(project_path, clip)
puts "Added #{target_name} and embedded it in PorizoApp"
